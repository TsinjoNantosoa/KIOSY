import hashlib
import json

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.schemas import OrderInput, QuoteInput, TestPaymentInput
from app.api.serializers import order_out
from app.core.config import Settings, get_settings
from app.core.errors import DomainError
from app.core.security import current_user, optional_user, utcnow
from app.db.base import get_db
from app.db.models import (
    IdempotencyOperation,
    Order,
    PaymentAttempt,
    PaymentEvent,
    Reservation,
    User,
)
from app.domains import idempotency
from app.domains.audit import record_audit
from app.domains.catalog_service import get_latest_offer
from app.domains.commerce_service import checkout, create_order, eligibility, fulfill_order, quote

router = APIRouter(prefix="/v1")


def load_order_parts(db: Session, order: Order) -> tuple[PaymentAttempt | None, Reservation | None]:
    payment = db.scalar(
        select(PaymentAttempt)
        .where(PaymentAttempt.order_id == order.id)
        .order_by(PaymentAttempt.created_at.desc())
    )
    return payment, db.get(Reservation, order.id)


@router.post("/orders/quote")
def make_quote(
    payload: QuoteInput,
    db: Session = Depends(get_db),
    user: User | None = Depends(optional_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    return quote(db, user, payload.offer_id, payload.renewal_of_subscription_id, settings)


@router.post("/orders", status_code=201)
def make_order(
    payload: OrderInput,
    idempotency_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    operation, replay = idempotency.begin(
        db, user.id, "create_order", idempotency_key, payload.model_dump(mode="json")
    )
    if replay is not None:
        return replay
    result = create_order(db, user, payload.model_dump(mode="json"), settings)
    record_audit(
        db,
        action="order.created",
        target_type="order",
        target_id=result["id"],
        result="success",
        request_id="api",
        actor=user,
        metadata={"offer_id": payload.offer_id},
    )
    idempotency.complete(operation, result, 201, "order", result["id"])
    db.commit()
    return result


@router.get("/operations/by-idempotency-key/{key}")
def operation(
    key: str, operation: str, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> dict:
    row = db.scalar(
        select(IdempotencyOperation).where(
            IdempotencyOperation.actor_id == user.id,
            IdempotencyOperation.operation == operation,
            IdempotencyOperation.key == key,
        )
    )
    if not row:
        raise DomainError(404, "NOT_FOUND", "Opération introuvable.")
    return {
        "state": row.state,
        "operation": row.operation,
        "resource_type": row.resource_type,
        "resource_id": row.resource_id,
        "response_status": row.response_status,
        "result": row.response_body if row.state == "completed" else None,
    }


@router.get("/orders/{order_id}")
def get_order(order_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)) -> dict:
    order = db.scalar(select(Order).where(Order.id == order_id, Order.user_id == user.id))
    if not order:
        raise DomainError(404, "NOT_FOUND", "Commande introuvable.")
    return order_out(order, *load_order_parts(db, order))


@router.get("/me/orders")
def my_orders(db: Session = Depends(get_db), user: User = Depends(current_user)) -> list[dict]:
    rows = db.scalars(select(Order).where(Order.user_id == user.id).order_by(Order.created_at.desc())).all()
    return [order_out(row, *load_order_parts(db, row)) for row in rows]


@router.get("/me/eligibility")
def my_eligibility(
    offer_ids: str, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> list[dict]:
    return [
        eligibility(db, user, get_latest_offer(db, offer_id)) for offer_id in offer_ids.split(",") if offer_id
    ]


@router.post("/orders/{order_id}/checkout", status_code=201)
def create_checkout(
    order_id: str,
    idempotency_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    operation, replay = idempotency.begin(
        db, user.id, "create_checkout", idempotency_key, {"order_id": order_id}
    )
    if replay is not None:
        return replay
    result = checkout(db, user, order_id, settings)
    record_audit(
        db,
        action="payment.checkout.created",
        target_type="order",
        target_id=order_id,
        result="success",
        request_id="api",
        actor=user,
        metadata={"mode": result["mode"]},
    )
    idempotency.complete(operation, result, 201, "payment_session", result["session_id"])
    db.commit()
    return result


@router.get("/test-payments/{session_id}", response_class=HTMLResponse)
def test_payment_page(
    session_id: str, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)
) -> str:
    if not settings.test_payment_enabled:
        raise DomainError(404, "NOT_FOUND", "Simulateur indisponible.")
    attempt = db.scalar(select(PaymentAttempt).where(PaymentAttempt.provider_session_id == session_id))
    if not attempt:
        raise DomainError(404, "NOT_FOUND", "Session de paiement introuvable.")
    return f"""<!doctype html><html lang='fr'><meta charset='utf-8'><title>Paiement de test Kiosy</title>
    <body><main><h1>Paiement de test uniquement</h1><p>Commande {attempt.order_id}</p>
    <form method='post' action='/v1/test-payments/{session_id}/complete'><button name='outcome' value='confirm'>Confirmer</button><button name='outcome' value='decline'>Refuser</button><button name='outcome' value='cancel'>Annuler</button></form>
    </main></body></html>"""


@router.post("/test-payments/{session_id}/complete")
async def complete_test_payment(
    session_id: str,
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> RedirectResponse:
    if not settings.test_payment_enabled:
        raise DomainError(404, "NOT_FOUND", "Simulateur indisponible.")
    form = await request.form()
    outcome = str(form.get("outcome", "decline"))
    if outcome not in {"confirm", "decline", "cancel"}:
        raise DomainError(422, "INVALID_OUTCOME", "Résultat de test invalide.")
    attempt = db.scalar(
        select(PaymentAttempt).where(PaymentAttempt.provider_session_id == session_id).with_for_update()
    )
    if not attempt:
        raise DomainError(404, "NOT_FOUND", "Session de paiement introuvable.")
    process_test_outcome(db, attempt, outcome, f"browser-{session_id}-{outcome}")
    db.commit()
    frontend = settings.frontend_origins[0]
    return RedirectResponse(f"{frontend}/paiement/retour?order_id={attempt.order_id}", status_code=303)


def process_test_outcome(db: Session, attempt: PaymentAttempt, outcome: str, event_id: str) -> None:
    existing = db.scalar(
        select(PaymentEvent).where(
            PaymentEvent.provider == "kiosy-test", PaymentEvent.provider_event_id == event_id
        )
    )
    if existing:
        return
    payload_hash = hashlib.sha256(json.dumps({"outcome": outcome}, sort_keys=True).encode()).hexdigest()
    event = PaymentEvent(
        provider="kiosy-test",
        provider_event_id=event_id,
        attempt_id=attempt.id,
        event_type=outcome,
        payload_hash=payload_hash,
        received_at=utcnow(),
    )
    db.add(event)
    # SessionLocal disables autoflush; materialize the unique provider event now so
    # another event from the same batch can observe it before commit.
    db.flush()
    order = db.scalar(select(Order).where(Order.id == attempt.order_id).with_for_update())
    if not order:
        raise DomainError(404, "NOT_FOUND", "Commande introuvable.")
    if outcome == "confirm":
        attempt.status = "succeeded"
        fulfill_order(db, order, attempt)
    elif order.status.value == "fulfilled":
        # A stale negative notification cannot undo persisted rights.
        pass
    elif outcome == "cancel":
        attempt.status = "cancelled"
        order.status = "cancelled"
    else:
        attempt.status = "failed"
        order.status = "created"
    event.processed_at = utcnow()


@router.post("/test-payments/{session_id}/simulate")
def simulate_test_payment(
    session_id: str,
    payload: TestPaymentInput,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    user: User = Depends(current_user),
) -> dict:
    if not settings.test_payment_enabled or "admin" not in user.roles:
        raise DomainError(404, "NOT_FOUND", "Simulateur indisponible.")
    attempt = db.scalar(
        select(PaymentAttempt).where(PaymentAttempt.provider_session_id == session_id).with_for_update()
    )
    if not attempt:
        raise DomainError(404, "NOT_FOUND", "Session introuvable.")
    if payload.outcome in {"delay", "no_response"}:
        attempt.status = "pending"
    else:
        event_id = f"sim-{session_id}-{payload.outcome}"
        if payload.out_of_order and payload.outcome == "confirm":
            process_test_outcome(db, attempt, "confirm", f"{event_id}-newer")
            process_test_outcome(db, attempt, "decline", f"{event_id}-older")
        else:
            process_test_outcome(db, attempt, payload.outcome, event_id)
        if payload.duplicate:
            process_test_outcome(db, attempt, payload.outcome, event_id)
    db.commit()
    order = db.get(Order, attempt.order_id)
    return order_out(order, *load_order_parts(db, order))
