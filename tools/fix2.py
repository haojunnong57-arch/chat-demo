import pathlib
import sys


def rep(path, old, new, marker):
    p = pathlib.Path(path)
    s = p.read_text()
    if marker in s:
        print('skip', path)
        return
    if old not in s:
        print('MISS', path)
        sys.exit(1)
    p.write_text(s.replace(old, new, 1))
    print('ok', path)


# i18n 语法修：补逗号、去双重逗号
rep(
    'src/i18n/zh.ts',
    "settingsChatBackgroundEmpty: '点击这里选择一张照片'\n  settingsChatBackgroundDefault: '原版',\n  settingsChatBackgroundSea: '海景',,",
    "settingsChatBackgroundEmpty: '点击这里选择一张照片',\n  settingsChatBackgroundDefault: '原版',\n  settingsChatBackgroundSea: '海景',",
    'settingsChatBackgroundSea: \'海景\','
)
rep(
    'src/i18n/en.ts',
    "settingsChatBackgroundEmpty: 'Tap here to choose a photo'\n  settingsChatBackgroundDefault: 'Original',\n  settingsChatBackgroundSea: 'Sea cave',,",
    "settingsChatBackgroundEmpty: 'Tap here to choose a photo',\n  settingsChatBackgroundDefault: 'Original',\n  settingsChatBackgroundSea: 'Sea cave',",
    'settingsChatBackgroundSea: \'Sea cave\','
)

# 角色卡对话顺序：先建会话再挂指令，否则会被 newChat 清掉
rep(
    'src/services/roleplay/store.ts',
    '  setPendingSessionInstructions(roleInstructions(card))\n  newChat()',
    '  newChat()\n  setPendingSessionInstructions(roleInstructions(card))',
    '  newChat()\n  setPendingSessionInstructions(roleInstructions(card))',
)

print('FIX2_OK')
