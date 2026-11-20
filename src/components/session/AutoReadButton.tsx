import { useTranslate } from '../../i18n/index.js'
import { setAutoRead, useSettings } from '../../services/settings.js'
import { primeReadAloud, stopReadAloud } from '../../services/speech/readAloud.js'
import { IconVolumeMuteOutline16, IconVolumeOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'

/** 右上角自动朗读开关：开启后每次 AI 回复完成自动朗读。 */
export const AutoReadButton = () => {
  const t = useTranslate()
  const autoRead = useSettings((state) => state.autoRead)
  return (
    <IconButton
      size="xl"
      tone="primary"
      aria-pressed={autoRead}
      aria-label={t(autoRead ? 'autoReadOn' : 'autoReadOff')}
      icon={autoRead ? <IconVolumeOutline16 /> : <IconVolumeMuteOutline16 />}
      tooltip={t(autoRead ? 'autoReadOnTooltip' : 'autoReadOffTooltip')}
      tooltipPlacement="bottom"
      onClick={() => {
        if (autoRead) {
          stopReadAloud()
          setAutoRead(false)
        } else {
          primeReadAloud()
          setAutoRead(true)
        }
      }}
    />
  )
}
