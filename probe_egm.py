import os
import re

import requests
from playwright.sync_api import sync_playwright

NTFY_TOPIC = os.environ.get('NTFY_TOPIC')
UA = 'Mozilla/5.0 (compatible; bes-veri-testi)'
HOME = os.environ.get('PROBE_HOME', 'https://www.egm.org.tr/')
PAGES = os.environ.get('PROBE_URLS', ','.join([
    'https://www.egm.org.tr/bilgi-merkezi/istatistikler/',
    'https://emeklilik.egm.org.tr/eyf-anasayfa',
    'https://emeklilik.egm.org.tr/fon-kunyesi-anasayfa',
])).split(',')


def clean(html):
    html = re.sub(r'<script.*?</script>|<style.*?</style>', ' ', html, flags=re.S)
    html = re.sub(r'<[^>]+>', ' ', html)
    return re.sub(r'\s+', ' ', html).strip()


def home_summary():
    try:
        r = requests.get(HOME, headers={'User-Agent': UA}, timeout=30)
        r.encoding = 'utf-8'
        txt = clean(r.text)
        i = txt.lower().find('katılımcı')
        snip = txt[max(0, i - 120):i + 380] if i >= 0 else 'Katilimci metni bulunamadi'
        return f'ANA SAYFA HTTP {r.status_code}, {len(r.text)} bayt\n{snip}'
    except Exception as e:
        return f'ANA SAYFA HATA {e}'


def probe(browser, url):
    ctx = browser.new_context(user_agent=UA, locale='tr-TR')
    pg = ctx.new_page()
    seen = []

    def on_resp(resp):
        try:
            ct = resp.headers.get('content-type', '')
        except Exception:
            ct = ''
        u = resp.url
        if any(k in ct for k in ('json', 'spreadsheet', 'excel', 'csv', 'xml')) or '/api/' in u.lower():
            body = ''
            try:
                body = resp.text()[:140].replace('\n', ' ')
            except Exception:
                pass
            seen.append((resp.status, ct.split(';')[0], u, body))

    pg.on('response', on_resp)
    try:
        pg.goto(url, wait_until='networkidle', timeout=60000)
        pg.wait_for_timeout(3000)
        text = re.sub(r'\s+', ' ', pg.inner_text('body')).strip()
        ntables = pg.locator('table').count()
    except Exception as e:
        text, ntables = f'HATA {e}', 0
    ctx.close()
    out = [f'SAYFA {url}', f'metin {len(text)} karakter, tablo sayisi {ntables}', text[:220]]
    uniq, keys = [], set()
    for s in seen:
        if s[2] not in keys:
            keys.add(s[2])
            uniq.append(s)
    out.append(f'veri istekleri: {len(uniq)}')
    for st, ct, u, body in uniq[:6]:
        out.append(f' [{st}] {ct} {u[:110]}')
        if body:
            out.append(f'   > {body}')
    return '\n'.join(out)


def notify(text):
    if not NTFY_TOPIC:
        return
    try:
        r = requests.post(
            f'https://ntfy.sh/{NTFY_TOPIC}',
            data=text[:3900].encode('utf-8'),
            headers={'Title': 'EGM veri testi', 'Priority': 'default'},
            timeout=15,
        )
        print('ntfy:', r.status_code)
    except Exception as e:
        print(f'ntfy gonderilemedi: {e}')


if __name__ == '__main__':
    parts = [home_summary()]
    with sync_playwright() as p:
        browser = p.chromium.launch(**({'executable_path': os.environ['PW_EXE']} if os.environ.get('PW_EXE') else {}))
        for u in PAGES:
            parts.append(probe(browser, u.strip()))
        browser.close()
    text = '\n\n'.join(parts)
    print(text)
    print(f'[{len(text)} karakter]')
    notify(text)
