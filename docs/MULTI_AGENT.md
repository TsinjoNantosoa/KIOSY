# Système multi-agent KIA

```text
START → COORDINATE
  ├─ CLARIFY → WAITING_USER → RESUME
  ├─ CATALOG → SUBSCRIPTIONS → CONDITIONS
  ├─ SUPPORT → [CREATE_SUPPORT_CASE sur demande explicite]
  └─ DIRECT
          ↓
       COMPOSE
          ↓
  PREPARE_PURCHASE ou PREPARE_CANCELLATION
          ↓
  WAITING_APPROVAL → RESUME → COMPOSE → COMPLETED
```

Le coordinateur délègue à quatre spécialistes : catalogue, abonnements/droits, conditions documentaires et support. Tous utilisent les clients MCP officiels ; ils ne lisent pas directement les tables métier. Les sorties `AgentResult` sont validées par Pydantic.

Les interruptions LangGraph sont persistées dans PostgreSQL avec `thread_id = run.id`. `waiting_user` et `waiting_approval` reprennent le même checkpoint via `Command(resume=...)`. Les attentes humaines ne consomment pas le budget de temps actif.

Les actions sensibles sont préparées en proposition. La confirmation revalide l’acteur et l’état métier côté serveur. Achat et résiliation ont une preuve de reprise automatisée ; un ticket support n’est créé que lorsque l’utilisateur le demande explicitement.
