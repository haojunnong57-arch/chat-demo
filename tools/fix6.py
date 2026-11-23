import pathlib

DROP_KEYS = ('settingsChatBackgroundDefault', 'settingsChatBackgroundSea')

for f in ['src/i18n/zh.ts', 'src/i18n/en.ts']:
    p = pathlib.Path(f)
    lines = p.read_text().split('\n')
    out = []
    for line in lines:
        if any(k in line for k in DROP_KEYS):
            continue
        if 'settingsChatBackgroundEmpty' in line and not line.rstrip().endswith(','):
            line = line.rstrip() + ','
        out.append(line)
    p.write_text('\n'.join(out))
    print('cleaned', f)

# 自检：不能残留新旧 key
for f in ['src/i18n/zh.ts', 'src/i18n/en.ts']:
    s = pathlib.Path(f).read_text()
    assert 'settingsChatBackgroundDefault' not in s
    assert 'settingsChatBackgroundSea' not in s
    assert "settingsChatBackgroundEmpty: '点击这里选择一张照片'," in s or "settingsChatBackgroundEmpty: 'Tap here to choose a photo'," in s
print('FIX6_OK')
