#!/usr/bin/env python3
"""用日常 Chrome（AppleScript + 系统鼠标点击）发一篇小红书图文。
用法：python3 scripts/social/xhs-apple-publish.py promo/xhs-daily/am.json [--dry]
依赖：Chrome 已登录创作平台；/tmp/click 或 ~/bin/click 可用。
"""
import base64
import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CLICK = os.path.expanduser('~/bin/click')
if not os.path.exists(CLICK):
    CLICK = '/tmp/click'


def osa(script, arg=None):
    cmd = ['osascript', '-']
    if arg is not None:
        cmd.append(arg)
    result = subprocess.run(
        cmd, input=script, text=True, capture_output=True, timeout=90
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result.stdout.strip()


def run_js(js, wait=0):
    if wait:
        time.sleep(wait)
    script = '''on run argv
  tell application "Google Chrome"
    set t to (last tab of front window whose URL contains "creator.xiaohongshu.com/publish")
    set code to (read (POSIX file (item 1 of argv)) as «class utf8»)
    return execute t javascript code
  end tell
end run'''
    path = '/tmp/xhs-js-run.js'
    with open(path, 'w') as f:
        f.write(js)
    return osa(script, path)


def open_publish_tab():
    osa('''tell application "Google Chrome"
  activate
  tell front window
    make new tab at end of tabs with properties {URL:"https://creator.xiaohongshu.com/publish/publish?source=official"}
  end tell
end tell''')
    time.sleep(6)


def activate_publish_tab():
    osa('''tell application "Google Chrome"
  activate
  tell front window
    set idx to 0
    set i to 0
    repeat with t in tabs
      set i to i + 1
      if (URL of t) contains "creator.xiaohongshu.com/publish" then set idx to i
    end repeat
    if idx > 0 then set active tab index to idx
  end tell
end tell''')
    time.sleep(0.4)


def dismiss_draft():
    js = r'''(()=>{const labels=['离开','放弃','取消'];const t=[...document.querySelectorAll('button,div,span')].find(e=>e.children.length===0&&labels.includes(e.textContent.trim()));if(!t)return 'none';(t.closest('button,div')||t).click();return t.textContent.trim()})()'''
    return run_js(js, wait=0)


def click_upload_tab():
    js = r'''(()=>{const norm=t=>String(t||'').replace(/[​-‍﻿]/g,'').trim();const tabs=[...document.querySelectorAll('.creator-tab')].filter(e=>{const r=e.getBoundingClientRect();return e.offsetParent!==null&&r.x>0&&r.width>0});const tab=tabs.find(e=>e.textContent.includes('上传图文'))||[...document.querySelectorAll('*')].find(e=>{const r=e.getBoundingClientRect();return e.children.length===0&&norm(e.textContent)==='上传图文'&&e.offsetParent!==null&&r.x>0});if(!tab)return 'no-tab';(tab.closest('.creator-tab')||tab).click();return 'clicked'})()'''
    return run_js(js, wait=1)


def wait_for_editor(seconds=20):
    deadline = time.time() + seconds
    while time.time() < deadline:
        state = run_js('JSON.stringify({title:!!document.querySelector(\'input[placeholder*="标题"]\'),upload:[...document.querySelectorAll(".creator-tab")].some(e=>e.textContent.includes("上传图文")&&e.getBoundingClientRect().x>0),text:document.body.innerText.slice(0,80)})')
        try:
            data = json.loads(state)
        except Exception:
            data = {}
        if data.get('upload') or data.get('title'):
            return data
        time.sleep(1)
    return {'timeout': True}


def attach_image(path):
    with open(path, 'rb') as f:
        b64 = base64.b64encode(f.read()).decode()
    ext = os.path.splitext(path)[1].lower()
    mime = 'image/png' if ext == '.png' else 'image/jpeg'
    name = os.path.basename(path)
    js = r'''(()=>{window.__xhsAttach={state:'start'};fetch('data:%s;base64,%s').then(r=>r.blob()).then(b=>{const f=new File([b],%s,{type:'%s'});const dt=new DataTransfer();dt.items.add(f);const inp=document.querySelector('input[type=file]');if(!inp){window.__xhsAttach={state:'no-input'};return}inp.files=dt.files;inp.dispatchEvent(new Event('change',{bubbles:true}));window.__xhsAttach={state:'attached',size:f.size}}).catch(e=>{window.__xhsAttach={state:'error',msg:String(e)}});return 'started'})()''' % (
        mime, b64, json.dumps(name), mime
    )
    result = run_js(js)
    return result


def attach_state():
    return run_js('JSON.stringify(window.__xhsAttach||{state:"none"})')


def fill(post):
    js = '''(()=>{const title=%s;const body=%s;const ti=document.querySelector('input[placeholder*="标题"]');if(!ti)return JSON.stringify({err:'no-title'});const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(ti,title);ti.dispatchEvent(new Event('input',{bubbles:true}));const ed=[...document.querySelectorAll('[contenteditable=true]')].find(e=>e.offsetParent!==null);if(!ed)return JSON.stringify({err:'no-editor'});ed.focus();document.execCommand('insertText',false,body);return JSON.stringify({title:ti.value,bodyLen:ed.innerText.length})})()''' % (
        json.dumps(post['title'], ensure_ascii=False),
        json.dumps(post['body'], ensure_ascii=False),
    )
    return run_js(js)


def button_coords():
    js = r'''(()=>{const h=document.querySelector('xhs-publish-btn');if(!h)return JSON.stringify({err:'no-host'});const r=h.getBoundingClientRect();const x=r.x+r.width*0.605,y=r.y+r.height*0.5;return JSON.stringify({sx:Math.round(window.screenX+x),sy:Math.round(window.screenY+(window.outerHeight-window.innerHeight)+y),rect:{x:r.x,y:r.y,w:r.width,h:r.height}})})()'''
    return json.loads(run_js(js))


def status():
    js = r'''JSON.stringify({url:location.href,success:document.body.innerText.includes('发布成功'),verify:document.body.innerText.includes('扫码验证'),tail:document.body.innerText.slice(-160)})'''
    return json.loads(run_js(js))


def main():
    post_path = sys.argv[1]
    dry = '--dry' in sys.argv
    current = '--current' in sys.argv
    index = 0
    if '--index' in sys.argv:
        index = int(sys.argv[sys.argv.index('--index') + 1])
    with open(post_path) as f:
        data = json.load(f)
    post = data[index] if isinstance(data, list) else data
    image = post['image']
    if not os.path.isabs(image):
        image = os.path.join(ROOT, image)

    if current:
        print('[1] use current publish tab')
    else:
        print('[1] open publish page')
        open_publish_tab()
    print('ready:', wait_for_editor())
    print('draft dialog:', dismiss_draft())
    print('upload tab:', click_upload_tab())
    print('[2] attach image', image)
    print('attach:', attach_image(image))
    time.sleep(15)
    print('attach state:', attach_state())
    print('[3] fill title/body')
    print('fill:', fill(post))
    time.sleep(2)
    coords = button_coords()
    print('coords:', coords)
    if dry:
        print('dry run, stop before click')
        return
    print('[4] click publish')
    activate_publish_tab()
    # 话题下拉可能自动弹出并盖住发布按钮，先按 Esc 关掉
    osa('tell application "System Events" to key code 53')
    time.sleep(0.3)
    subprocess.run([CLICK, str(coords['sx']), str(coords['sy'])], check=True)
    time.sleep(8)
    print('status:', status())


if __name__ == '__main__':
    main()
