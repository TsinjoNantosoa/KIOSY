# Limites opérationnelles

| Limite par défaut | Valeur |
|---|---:|
| Délégations par run | 4 |
| Appels outils MCP | 12 globaux |
| Appels LLM | 6 globaux |
| Tokens estimés | 12 000 |
| Temps actif | 120 s |
| Taille message | 8 000 caractères |
| Runs par utilisateur/heure | 20 |
| Runs actifs par utilisateur | 2 |
| Runs actifs globaux | 20 |
| Bail worker / heartbeat | 60 s / 20 s |

Les compteurs sont persistés dans le checkpoint et repris entre spécialistes. Le coût du provider déterministe est marqué `ESTIMATED` et vaut 0 ; aucun coût Azure n’est annoncé sans télémétrie réelle. Les erreurs sont structurées (`TOOL_BUDGET_EXCEEDED`, `LLM_BUDGET_EXCEEDED`, `TOKEN_BUDGET_EXCEEDED`, `RUN_ACTIVE_TIMEOUT`, `RUN_RATE_LIMIT`).
