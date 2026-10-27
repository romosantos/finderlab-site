import sys,asyncio,os,base64
sys.path.insert(0,os.path.dirname(__file__))
from pages import PAGES
from playwright.async_api import async_playwright
ROOT=sys.argv[1]; F='node_modules/@fontsource/sora/files/'
def b64(p): return base64.b64encode(open(p,'rb').read()).decode()
fonts=''.join(f"@font-face{{font-family:Sora;font-weight:{w};src:url(data:font/woff2;base64,{b64(F+f'sora-latin-{w}-normal.woff2')}) format('woff2')}}" for w in (400,700,800))
logo='data:image/png;base64,'+b64(ROOT+'/assets/site/ba17e5fe5d7f586c4b5c649ba1c52ab0.png')
def html(title,sub,product):
    pill='<div class="pill">PRODUTO FINDER LAB</div>' if product else '<div class="pill">APPLIED INTELLIGENCE LAB</div>'
    fs=84 if len(title)<=16 else 62
    return f'''<html><head><style>{fonts}*{{box-sizing:border-box}}body{{margin:0;width:1200px;height:630px;font-family:Sora,sans-serif;color:#fff;background:radial-gradient(800px 500px at 85% 15%,rgba(116,67,245,.55),transparent 60%),radial-gradient(600px 420px at 0% 100%,rgba(116,67,245,.35),transparent 60%),#0D0A1A;position:relative;overflow:hidden}}
.wrap{{position:absolute;inset:0;padding:64px 72px;display:flex;flex-direction:column;justify-content:space-between}}
.pill{{display:inline-block;background:#6A3BE8;padding:10px 20px;border-radius:999px;font-weight:700;font-size:18px;letter-spacing:2px}}
h1{{margin:22px 0 0;font-weight:800;font-size:{fs}px;line-height:1.05;letter-spacing:-2px;max-width:1000px}}
p{{margin:22px 0 0;font-size:30px;line-height:1.4;color:#C4BDDC;max-width:940px}}
.foot{{display:flex;justify-content:space-between;align-items:center;font-size:22px;color:#B79CFF;font-weight:700}}
img{{height:46px;width:auto;align-self:flex-start}}</style></head><body><div class="wrap"><img src="{logo}"><div>{pill}<h1>{title}</h1><p>{sub}</p></div><div class="foot"><span>finderlab.com.br</span><span style="width:120px;height:6px;border-radius:6px;background:linear-gradient(90deg,#7443F5,#A88BFF)"></span></div></div></body></html>'''
async def main():
    os.makedirs(ROOT+'/assets/seo',exist_ok=True)
    async with async_playwright() as pw:
        b=await pw.chromium.launch(); pg=await b.new_page(viewport={'width':1200,'height':630})
        for p in PAGES:
            await pg.set_content(html(p['og_title'],p['og_sub'],p['type']=='product')); await pg.wait_for_timeout(300)
            await pg.screenshot(path=ROOT+p['og'])
        # logo quadrado p/ dados estruturados
        await pg.set_viewport_size({'width':512,'height':512})
        await pg.set_content(f'<body style="margin:0;width:512px;height:512px;background:#0D0A1A;display:flex;align-items:center;justify-content:center"><img src="{logo}" style="width:400px"></body>')
        await pg.screenshot(path=ROOT+'/assets/seo/logo-512.png')
        await b.close()
asyncio.run(main())
