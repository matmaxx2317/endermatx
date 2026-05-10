from fastapi import FastAPI
from fastapi.responses import HTMLResponse

app = FastAPI()

HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>endermatx</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0d0d0d;
    color: #e0e0e0;
    font-family: 'Courier New', Courier, monospace;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  p { font-size: 1rem; letter-spacing: 0.05em; }
</style>
</head>
<body>
  <p>Congrats, you have reached the end. Start fighting the dragon</p>
</body>
</html>"""


@app.get("/{full_path:path}")
async def landing(full_path: str):
    return HTMLResponse(HTML)
