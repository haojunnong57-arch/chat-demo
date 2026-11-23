import pathlib

p = pathlib.Path('src/components/settings/BackgroundSetting.tsx')
s = p.read_text()
s = s.replace("{t('settingsChatBackgroundDefault')}", '原版')
s = s.replace("{t('settingsChatBackgroundSea')}", '海景')
p.write_text(s)
assert 'settingsChatBackgroundSea' not in s, 'still has i18n key'
print('FIX7_OK')
