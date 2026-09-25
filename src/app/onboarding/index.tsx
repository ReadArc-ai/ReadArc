import { useState, type JSX } from 'react'
import { useT } from '../../i18n'
import { useApp } from '../../store/app'
import { usePaper } from '../../store/paper'
import { useModels } from '../../store/models'
import { BrandMark } from '../shell/icons'

function finish(): void {
  window.readarc.patchSettings({ onboarded: true })
  useApp.getState().setScreen('reader')
}

/** 首次启动引导 [P5]：两步可读第一篇——接入模型（云端 Key 或本地模型，二选一）、打开论文。
 *  块级滚动容器，不用 flex 居中——内容高于视口时上方会被裁掉（原型踩坑）。 */
export function OnboardingScreen(): JSX.Element {
  const t = useT()
  const importing = usePaper((s) => s.importing)
  const detectLocal = useModels((s) => s.detectLocal)
  const detected = useModels((s) => s.detected)
  const providers = useModels((s) => s.state?.providers)
  // 探到的服务显示正式名字（LM Studio），不是配置里的 slug（lmstudio）
  const nameOf = (slug: string): string => providers?.find((p) => p.slug === slug)?.name ?? slug
  const [detecting, setDetecting] = useState(false)

  const load = useModels((s) => s.load)
  const runDetect = async (): Promise<void> => {
    setDetecting(true)
    try {
      await detectLocal()
      await load() // 探到的服务刚写进配置：重取一次才拿到它的正式名字
    } finally {
      setDetecting(false)
    }
  }

  const pickPdf = async (): Promise<void> => {
    await usePaper.getState().pickAndImport()
    if (usePaper.getState().bundle) finish()
  }

  return (
    <section className="screen">
      <div className="onboard-scroll">
        <div className="onboard-content">
          <div className="onboard-brand">
            <span className="onboard-mark">
              <BrandMark />
            </span>
            <span className="onboard-name">ReadArc</span>
          </div>
          <h1 className="onboard-title">{t('onboard.title')}</h1>
          <p className="onboard-sub">{t('onboard.lede')}</p>

          <div className="onboard-steps">
            <div className="onboard-step onboard-step--active">
              <span className="onboard-num">1</span>
              <div className="onboard-step-body">
                <div className="onboard-step-title">{t('onboard.step1.title')}</div>
                {/* 云端 Key 与本地模型是并列的两种方式，不是先后两步：左右并排，各自带自己的动作 */}
                <div className="onboard-options">
                  <div className="onboard-option">
                    <div className="onboard-option-title">{t('onboard.cloud.title')}</div>
                    <div className="onboard-step-desc">{t('onboard.step1.desc')}</div>
                    <button className="btn-accent" onClick={() => useApp.getState().setSettingsOpen(true, 'models')}>
                      {t('onboard.step1.cta')}
                    </button>
                  </div>
                  <div className="onboard-option">
                    <div className="onboard-option-title">{t('onboard.step2.title')}</div>
                    <div className="onboard-step-desc">{t('onboard.step2.desc')}</div>
                    <button className="btn-accent" onClick={() => void runDetect()} disabled={detecting}>
                      {detecting ? t('onboard.detecting') : t('onboard.detect')}
                    </button>
                    {detected && (
                      <div className="onboard-detect-result">
                        {detected.length > 0
                          ? t('onboard.detected', { list: detected.map((d) => nameOf(d.slug)).join('、') })
                          : t('onboard.detect-none')}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="onboard-step">
              <span className="onboard-num">2</span>
              <div>
                <div className="onboard-step-title">{t('onboard.step3.title')}</div>
                <div className="onboard-step-desc">{t('onboard.step3.desc')}</div>
                {/* 每一步的动作都放在步骤里，底部不再重复一个「开始读第一篇」 */}
                <button className="onboard-cta" onClick={() => void pickPdf()} disabled={importing}>
                  {t('onboard.start')}
                </button>
              </div>
            </div>
          </div>

          <div className="onboard-actions">
            <button className="onboard-skip" onClick={finish}>
              {t('onboard.skip')}
            </button>
            <span className="onboard-version">v{__APP_VERSION__}</span>
          </div>
        </div>
      </div>
    </section>
  )
}
