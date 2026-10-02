from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, model_validator

NonBlank = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LoginInput(StrictModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)


class RegisterInput(LoginInput):
    display_name: NonBlank = Field(max_length=120)
    accepted_terms_version: NonBlank = Field(max_length=80)


class ForgotInput(StrictModel):
    email: EmailStr


class ResetInput(StrictModel):
    token: str = Field(min_length=20, max_length=500)
    password: str = Field(min_length=12, max_length=200)


class PreferencesInput(StrictModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    time_zone: str | None = Field(default=None, min_length=1, max_length=80)
    language: Literal["fr", "mg", "en"] | None = None


class QuoteInput(StrictModel):
    offer_id: str
    renewal_of_subscription_id: str | None = None


class OrderInput(StrictModel):
    quote_id: str
    offer_id: str
    offer_version: int = Field(gt=0)
    renewal_of_subscription_id: str | None = None
    accepted_conditions_version: NonBlank


class Money(StrictModel):
    amount: int = Field(ge=0)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    scale: int = Field(ge=0, le=6)


class Duration(StrictModel):
    unit: Literal["day", "month", "year"]
    count: int = Field(gt=0, le=120)


class OfferCreateInput(StrictModel):
    kind: Literal["free", "single", "subscription"]
    title: NonBlank = Field(max_length=240)
    description: NonBlank = Field(max_length=4000)
    price: Money
    duration: Duration | None
    scope: dict[str, Any]
    restrictions: list[str] = Field(max_length=30)
    conditions_version: NonBlank = Field(max_length=80)
    quota_total: int | None = Field(default=None, ge=0)
    status: Literal["active", "unavailable"]

    @model_validator(mode="after")
    def validate_kind(self) -> "OfferCreateInput":
        if self.kind == "free" and self.price.amount != 0:
            raise ValueError("a free offer must have a zero price")
        if self.kind == "subscription" and not self.duration:
            raise ValueError("a subscription requires a duration")
        return self


class PublicationInput(StrictModel):
    title: NonBlank = Field(max_length=240)
    author: NonBlank = Field(max_length=200)
    publisher_id: str
    universe: Literal["presse", "business", "culture"]
    language: Literal["fr", "mg", "en"]
    summary: NonBlank = Field(max_length=10_000)
    tags: list[str] = Field(max_length=30)


class EditionInput(StrictModel):
    label: NonBlank = Field(max_length=180)
    format: Literal["text", "pdf"]
    published_at: datetime
    permissions: dict[Literal["public_excerpt", "ai_indexing", "full_text_public"], bool]
    is_free: bool


class PublicationCreateInput(PublicationInput):
    edition: EditionInput


class StartRunInput(StrictModel):
    text: NonBlank = Field(max_length=8_000)


class SupportCreateInput(StrictModel):
    category: Literal["access", "payment", "subscription", "content", "other"]
    subject: NonBlank = Field(max_length=240)
    body: NonBlank = Field(max_length=10_000)
    order_id: str | None = None
    edition_id: str | None = None
    subscription_id: str | None = None


class SupportReplyInput(StrictModel):
    body: NonBlank = Field(max_length=10_000)


class TestPaymentInput(StrictModel):
    outcome: Literal["confirm", "decline", "cancel", "delay", "no_response"]
    duplicate: bool = False
    out_of_order: bool = False
