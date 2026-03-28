# Font Manager

The `font-manager` handles dynamic font loading, resolution, and registry logic for text rendering experiments across the `/docs` prototypes.

## Font Weight vs Name Mapping

In CSS and digital typography, semantic "named" font weights correspond directly to standardized numerical ranges on a scale from `100` to `900`. 

This enables predictable logic whether you are dealing with a modern variable font (using a `wght` axis) or legacy static font binaries (where each weight requires its own `.ttf` file).

The standard web typography mapping is:

*   **100** – Thin (Hairline)
*   **200** – Extra Light (Ultra Light)
*   **300** – Light
*   **400** – Regular (Normal)
*   **500** – Medium
*   **600** – Semi Bold (Demi Bold)
*   **700** – Bold
*   **800** – Extra Bold (Ultra Bold)
*   **900** – Black (Heavy)

When text is configured with a rule such as `font-weight: bold;`, the layout engine immediately resolves that to `700`. If you define `normal` or standard text, it defaults to `400`.
