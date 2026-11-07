from enum import Enum


class Status(Enum):
    IDLE = "idle"
    LOADING = "loading"
    DONE = "done"


def label(status: Status) -> str:
    match status:
        case Status.IDLE:
            return "idle"
        case _:
            return "busy"
