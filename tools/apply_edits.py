import pathlib
import sys


def patch(path, old, new, tag, marker):
    p = pathlib.Path(path)
    s = p.read_text()
    if marker in s:
        print('skip', tag)
        return
    if old not in s:
        print('MISS', tag)
        sys.exit(1)
    p.write_text(s.replace(old, new, 1))
    print('ok', tag)


# 1) 普通新建对话清空悬空的角色指令
STORE = 'src/services/chat/store.ts'
patch(
    STORE,
    'export const setPendingSessionInstructions = (value?: string) => {\n  pendingSessionInstructions = value\n}',
    'export const setPendingSessionInstructions = (value?: string) => {\n  pendingSessionInstructions = value\n}\n\n/** 普通新建对话时清掉悬空的角色指令，避免串味到新会话。 */\nexport const clearPendingSessionInstructions = () => {\n  pendingSessionInstructions = undefined\n}',
    'store:helper',
    'clearPendingSessionInstructions',
)
patch(
    STORE,
    'export const newChat = () => {\n  if (!get().importingHistory) {',
    'export const newChat = () => {\n  clearPendingSessionInstructions()\n  if (!get().importingHistory) {',
    'store:newChat',
    'clearPendingSessionInstructions()',
)

# 2) 角色卡对话改为先建会话再挂指令
patch(
    'src/services/roleplay/store.ts',
    '  setPendingSessionInstructions(roleInstructions(card))\n  newChat()',
    '  newChat()\n  setPendingSessionInstructions(roleInstructions(card))',
    'role:order',
    'setPendingSessionInstructions(roleInstructions(card))\n  newChat()',
)

# 3) 背景：两张默认预设
BG = 'src/components/settings/BackgroundSetting.tsx'
patch(
    BG,
    "import styles from './Settings.module.css'",
    "import styles from './Settings.module.css'\n\n/** 默认背景 2：海景 */\nconst SEA_CAVE_BACKGROUND = 'https://aka.doubaocdn.com/s/LjlYtUHQ6I'",
    'bg:const',
    'SEA_CAVE_BACKGROUND',
)
patch(
    BG,
    "      <div className={styles.backgroundDescription}>\n        {t('settingsChatBackgroundDescription')}\n      </div>",
    "      <div className={styles.backgroundDescription}>\n        {t('settingsChatBackgroundDescription')}\n      </div>\n      <div className={styles.backgroundActions}>\n        <Button variant={background === null ? 'primary' : 'outlined'} size=\"m\" onClick={() => setChatBackground(null)}>\n          {t('settingsChatBackgroundDefault')}\n        </Button>\n        <Button variant={background === SEA_CAVE_BACKGROUND ? 'primary' : 'outlined'} size=\"m\" onClick={() => setChatBackground(SEA_CAVE_BACKGROUND)}>\n          {t('settingsChatBackgroundSea')}\n        </Button>\n      </div>",
    'bg:buttons',
    'setChatBackground(SEA_CAVE_BACKGROUND)',
)

# 4) i18n 新增两个 key
import re
for f, zh in [('src/i18n/zh.ts', True), ('src/i18n/en.ts', False)]:
    p = pathlib.Path(f)
    s = p.read_text()
    if 'settingsChatBackgroundDefault' in s:
        print('skip i18n', f)
        continue
    m = re.search(r"\n  settingsChatBackgroundEmpty: '[^']*'", s)
    if not m:
        print('MISS i18n', f)
        sys.exit(1)
    add = ("\n  settingsChatBackgroundDefault: '原版',\n  settingsChatBackgroundSea: '海景'," if zh
           else "\n  settingsChatBackgroundDefault: 'Original',\n  settingsChatBackgroundSea: 'Sea cave',")
    s = s[:m.end()] + add + s[m.end():]
    p.write_text(s)
    print('ok i18n', f)

# 5) 首帧底色，避免启动白闪
HTML = 'src/index.html'
patch(
    HTML,
    '    <title>DeepSeek</title>',
    '    <title>DeepSeek</title>\n    <style>\n      html, body { background-color: #ffffff; }\n      html.dark, html.dark body { background-color: #16161a; }\n    </style>\n    <script>\n      (function () {\n        try {\n          var keys = [\'chat-demo:theme\', \'chat-demo:theme-preference\']\n          var saved = null\n          for (var i = 0; i < keys.length && !saved; i += 1) {\n            saved = localStorage.getItem(keys[i])\n          }\n          var dark = saved ? saved === \'dark\' : window.matchMedia(\'(prefers-color-scheme: dark)\').matches\n          if (dark) {\n            document.documentElement.classList.add(\'dark\')\n            var m = document.querySelector(\'meta[name="theme-color"]\')\n            if (m) m.setAttribute(\'content\', \'#16161a\')\n          }\n        } catch (e) {}\n      })()\n    </script>',
    'html:splash',
    'html.dark, html.dark body',
)

print('ALL_TARGETS_OK')
