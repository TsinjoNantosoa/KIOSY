from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import get_settings
from app.db import models  # noqa: F401
from app.db.base import Base

config = context.config
config.set_main_option("sqlalchemy.url", get_settings().database_url)
if config.config_file_name:
    fileConfig(config.config_file_name)
target_metadata = Base.metadata

# LangGraph owns and migrates these tables through setup_checkpointer. Keeping
# them outside Alembic autogeneration prevents `alembic check` from proposing
# destructive drops while preserving their dedicated lifecycle.
LANGGRAPH_TABLES = {
    "checkpoint_blobs",
    "checkpoint_migrations",
    "checkpoint_writes",
    "checkpoints",
}


def include_object(
    object_: object, name: str | None, type_: str, reflected: bool, compare_to: object | None
) -> bool:
    del object_, compare_to
    return not (reflected and type_ in {"table", "index"} and name in LANGGRAPH_TABLES)


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section), prefix="sqlalchemy.", poolclass=pool.NullPool
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            include_object=include_object,
        )
        with context.begin_transaction():
            context.run_migrations()


run_migrations_offline() if context.is_offline_mode() else run_migrations_online()
