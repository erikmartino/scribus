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

### Missing Weights and Fallback Matching

What happens if a user requests `font-weight: 700` (bold) but the active font family lacks a 700-weight file or definition? 

Web browsers follow a standardized fallback search algorithm:
1. **Search Upwards (for bold requested weights > 500):** The browser first tries to find a *bolder* weight. If `700` is missing, it checks for `800`, then `900`. 
2. **Search Downwards:** If no bolder font is found up to `900`, it reverses direction, checking lower weights starting at `600`, then `500`, `400`, all the way down to `100`.
3. **Synthetic Bolding ("Faux Bold"):** As a final resort, if the browser algorithm decides to map `700` requests onto a normal `400` font face, most rendering engines will automatically apply "faux bold" — artificially smearing/thickening the stroke of the glyphs to make them look bolder, though this usually degrades typographic quality.
