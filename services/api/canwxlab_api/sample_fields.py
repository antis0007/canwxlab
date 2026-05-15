import math
from datetime import UTC, datetime
from typing import Any


def generate_grid_field(
    width: int = 48, height: int = 32, field_name: str = "temperature"
) -> dict[str, Any]:
    values: list[list[float]] = []
    for y in range(height):
        row: list[float] = []
        for x in range(width):
            xn = x / max(width - 1, 1)
            yn = y / max(height - 1, 1)
            wave = math.sin(xn * math.tau * 2.0) * math.cos(yn * math.tau)
            if field_name == "precipitation":
                value = max(0.0, 4.0 * wave + 2.0 * math.sin((xn + yn) * math.tau))
            elif field_name == "wind_speed":
                value = 3.0 + 9.0 * abs(wave)
            elif field_name == "cloud_water":
                value = max(0.0, 0.8 * wave)
            else:
                value = -6.0 + 26.0 * (1.0 - yn) + 4.0 * wave
            row.append(round(value, 3))
        values.append(row)
    return {
        "field_name": field_name,
        "status": "mock",
        "generated_at": datetime.now(UTC).isoformat(),
        "grid": {
            "width": width,
            "height": height,
            "bbox": [-141.0, 41.0, -52.0, 83.0],
            "crs": "EPSG:4326",
        },
        "values": values,
    }
