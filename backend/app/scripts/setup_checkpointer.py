from langgraph.checkpoint.postgres import PostgresSaver

from app.core.config import get_settings


def main() -> None:
    connection = get_settings().database_url.replace("postgresql+psycopg://", "postgresql://")
    with PostgresSaver.from_conn_string(connection) as checkpointer:
        checkpointer.setup()
    print("LangGraph checkpoint schema ready")


if __name__ == "__main__":
    main()

