from api.db.db_client import DBClient

# Instantiate after importing the submodule so this instance wins over the
# `api.db.db_client` module attribute that Python auto-binds on the package.
# DBClient() is side-effect-free (empty body, no __init__) and the SQLAlchemy
# engine in api.db.database is created lazily, so this does not open any DB
# connection at import time.
db_client = DBClient()
