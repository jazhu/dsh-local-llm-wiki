import pathlib, sys
from playwright.sync_api import sync_playwright

html = pathlib.Path(r"F:\DSH-WorkSpace\dsh_plugin\dsh-wiki\docs\poster.html").as_uri()
out = pathlib.Path(r"F:\DSH-WorkSpace\dsh_plugin\dsh-wiki\docs\poster.png")

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1080, "height": 1440}, device_scale_factor=2)
    pg.goto(html)
    pg.wait_for_timeout(1200)
    pg.screenshot(path=str(out))
    b.close()

print("OK", out.stat().st_size, "bytes")
