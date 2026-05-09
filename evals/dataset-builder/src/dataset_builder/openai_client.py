"""Single shared OpenAI client.

Loads ``OPENAI_API_KEY`` from the repo-level ``.dev.vars`` (same source the
TS eval runner uses, see ``evals/scripts/run-classification-eval.ts``) so we
don't duplicate the secret in another file.
"""

from __future__ import annotations

import os
from functools import lru_cache

from dotenv import load_dotenv
from openai import OpenAI

from .config import DOTENV_PATH


@lru_cache(maxsize=1)
def get_client() -> OpenAI:
    if DOTENV_PATH.exists():
        load_dotenv(DOTENV_PATH)
    if not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError(
            f"OPENAI_API_KEY not set — populate it in {DOTENV_PATH} or the environment."
        )
    return OpenAI()
