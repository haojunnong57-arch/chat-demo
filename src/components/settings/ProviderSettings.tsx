import { useState } from 'react'
import clsx from 'clsx'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import {
  addInstance,
  removeInstance,
  setActiveInstance,
  updateInstance,
  useSettings,
} from '../../services/settings.js'
import { fetchModels } from '../../services/providers/models.js'
import {
  PROVIDER_DEFINITIONS,
  normalizeBaseUrl,
  providerDefinition,
  protocolNameKey,
} from '../../services/providers/registry.js'
import type {
  ModelsFailure,
  ProviderInstance,
  ProviderKind,
  Protocol,
} from '../../services/providers/types.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './Settings.module.css'

/** 实例列表 + 添加 / 编辑 / 删除流程；拉取模型失败时回退内置清单并允许手填模型名。 */
export const ProviderSettings = () => {
  const translate = useTranslate()
  const instances = useSettings((state) => state.instances)
  const activeId = useSettings((state) => state.activeInstanceId)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<ProviderInstance | null>(null)

  const openAdd = () => {
    setEditingId(null)
    setFormOpen(true)
  }

  const openEdit = (instance: ProviderInstance) => {
    setEditingId(instance.id)
    setFormOpen(true)
  }

  const confirmDelete = () => {
    if (!deleting) {
      return
    }
    if (instances.length <= 1) {
      showToast({ key: 'settingsProvidersDeleteLast', type: 'error' })
      return
    }
    removeInstance(deleting.id)
    setDeleting(null)
  }

  return (
    <div className={styles.providersBlock}>
      <div className={styles.blockTitle}>{translate('settingsProvidersTitle')}</div>
      <div className={styles.blockDescription}>{translate('settingsProvidersDescription')}</div>

      {instances.length === 0 ? (
        <div className={styles.providerEmpty}>{translate('settingsProvidersEmpty')}</div>
      ) : (
        <div className={styles.providerList}>
          {instances.map((instance) => {
            const definition = providerDefinition(instance.kind)
            const active = instance.id === activeId
            let host = instance.baseUrl
            try {
              host = new URL(instance.baseUrl).host
            } catch {
              // 地址不合法时原样展示
            }
            return (
              <div
                key={instance.id}
                className={clsx(styles.providerCard, active && styles.providerCardActive)}
              >
                <div className={styles.providerMain}>
                  <div className={styles.providerName}>
                    {translate(definition.nameKey)}
                    {instance.label ? (
                      <span className={styles.providerLabel}> · {instance.label}</span>
                    ) : null}
                    {active ? (
                      <span className={styles.providerBadge}>{translate('settingsProvidersActive')}</span>
                    ) : null}
                  </div>
                  <div className={styles.providerMeta}>
                    {host} · {instance.model}
                  </div>
                </div>
                <div className={styles.providerActions}>
                  {!active ? (
                    <Button variant="outlined" size="m" onClick={() => setActiveInstance(instance.id)}>
                      {translate('settingsProvidersSetActive')}
                    </Button>
                  ) : null}
                  <Button variant="outlined" size="m" onClick={() => openEdit(instance)}>
                    {translate('settingsProvidersEdit')}
                  </Button>
                  <Button variant="dangerOutlined" size="m" onClick={() => setDeleting(instance)}>
                    {translate('settingsProvidersDelete')}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className={styles.providerFormActions}>
        <Button variant="outlined" size="m" onClick={openAdd}>
          {translate('settingsProvidersAdd')}
        </Button>
      </div>

      {formOpen ? (
        <ProviderForm
          editingId={editingId}
          initial={instances.find((item) => item.id === editingId) ?? null}
          onSaved={() => setFormOpen(false)}
          onCancel={() => setFormOpen(false)}
        />
      ) : null}

      {deleting ? (
        <Modal
          title={translate('settingsProvidersDeleteConfirmTitle')}
          className={styles.deleteConfirm}
          onClose={() => setDeleting(null)}
          footer={
            <div className={styles.deleteActions}>
              <Button variant="outlined" autoFocus onClick={() => setDeleting(null)}>
                {translate('settingsProvidersCancel')}
              </Button>
              <Button variant="danger" onClick={confirmDelete}>
                {translate('settingsProvidersDelete')}
              </Button>
            </div>
          }
        >
          {translate('settingsProvidersDeleteConfirmDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

type FormState = {
  kind: ProviderKind
  label: string
  protocol: Protocol
  baseUrl: string
  apiKey: string
  models: string[]
  model: string
}

const failureText = (
  translate: ReturnType<typeof useTranslate>,
  failure: ModelsFailure
): string => {
  switch (failure.kind) {
    case 'unauthorized':
      return translate('modelsFetchUnauthorized')
    case 'endpointNotFound':
      return translate('modelsFetchNotFound')
    case 'network':
      return translate('modelsFetchNetwork')
    case 'protocol':
      return translate('modelsFetchParse')
    default:
      return translate('modelsFetchOther', { message: failure.message })
  }
}

const ProviderForm = ({
  editingId,
  initial,
  onSaved,
  onCancel,
}: {
  editingId: string | null
  initial: ProviderInstance | null
  onSaved: () => void
  onCancel: () => void
}) => {
  const translate = useTranslate()
  const [state, setState] = useState<FormState>(() =>
    initial
      ? {
          kind: initial.kind,
          label: initial.label,
          protocol: initial.protocol,
          baseUrl: initial.baseUrl,
          apiKey: initial.apiKey,
          models: initial.models,
          model: initial.model,
        }
      : {
          kind: 'deepseek',
          label: '',
          protocol: providerDefinition('deepseek').defaultProtocol,
          baseUrl: providerDefinition('deepseek').defaultBaseUrl,
          apiKey: '',
          models: [],
          model: '',
        }
  )
  const [fetching, setFetching] = useState(false)
  const [failure, setFailure] = useState<ModelsFailure | null>(null)

  const definition = providerDefinition(state.kind)

  const patch = (partial: Partial<FormState>) =>
    setState((current) => ({ ...current, ...partial }))

  const onKindChange = (kind: ProviderKind) => {
    const next = providerDefinition(kind)
    setState((current) => ({
      ...current,
      kind,
      protocol: next.defaultProtocol,
      baseUrl: next.defaultBaseUrl,
      models: [],
      model: '',
    }))
    setFailure(null)
  }

  const onFetchModels = async () => {
    setFetching(true)
    setFailure(null)
    const temporary: ProviderInstance = {
      id: 'fetch-tmp',
      kind: state.kind,
      label: state.label,
      protocol: state.protocol,
      baseUrl: normalizeBaseUrl(definition, state.baseUrl),
      apiKey: state.apiKey.trim(),
      models: [],
      model: state.model,
    }
    const result = await fetchModels(temporary)
    if (result.ok) {
      patch({ models: result.models })
    } else {
      setFailure(result.failure)
    }
    setFetching(false)
  }

  const onSave = () => {
    const fallbackModel = (state.model.trim() || definition.recommendedModels[0]) ?? ''
    const instance = {
      kind: state.kind,
      label: state.label.trim() || translate(definition.nameKey),
      protocol: state.protocol,
      baseUrl: normalizeBaseUrl(definition, state.baseUrl),
      apiKey: state.apiKey.trim(),
      models: state.models.length ? state.models : [...definition.recommendedModels],
      model: fallbackModel,
    }
    if (editingId) {
      updateInstance(editingId, instance)
    } else {
      addInstance(instance)
    }
    showToast({ key: 'settingsProvidersSave' })
    onSaved()
  }

  return (
    <div className={styles.providerForm}>
      <div className={styles.providerFormRow}>
        <div className={styles.providerField}>
          <div className={styles.providerFieldLabel}>{translate('settingsProvidersTitle')}</div>
          <Select
            ariaLabel={translate('settingsProvidersTitle')}
            value={state.kind}
            options={PROVIDER_DEFINITIONS.map((item) => ({
              value: item.kind,
              label: translate(item.nameKey),
            }))}
            onChange={onKindChange}
          />
        </div>
        <div className={styles.providerField}>
          <div className={styles.providerFieldLabel}>{translate('settingsProvidersProtocol')}</div>
          <Select
            ariaLabel={translate('settingsProvidersProtocol')}
            value={state.protocol}
            options={definition.protocols.map((protocol) => ({
              value: protocol,
              label: translate(protocolNameKey(protocol)),
            }))}
            onChange={(protocol) => patch({ protocol })}
          />
        </div>
        <div className={styles.providerField}>
          <div className={styles.providerFieldLabel}>{translate('settingsProvidersLabel')}</div>
          <input
            className={styles.endpointInput}
            type="text"
            value={state.label}
            placeholder={translate('settingsProvidersLabelPlaceholder')}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => patch({ label: event.target.value })}
          />
        </div>
      </div>

      <div className={styles.providerFormRow}>
        <div className={styles.providerField}>
          <div className={styles.providerFieldLabel}>{translate('settingsProvidersBaseUrl')}</div>
          <input
            className={styles.endpointInput}
            type="url"
            inputMode="url"
            value={state.baseUrl}
            placeholder={definition.defaultBaseUrl}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => patch({ baseUrl: event.target.value })}
          />
        </div>
        <div className={styles.providerField}>
          <div className={styles.providerFieldLabel}>{translate('settingsProvidersApiKey')}</div>
          <input
            className={styles.endpointInput}
            type="password"
            value={state.apiKey}
            placeholder={translate(definition.keyHintKey)}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => patch({ apiKey: event.target.value })}
          />
        </div>
      </div>

      {state.kind === 'kimi-code' ? (
        <div className={styles.providerHint}>{translate('settingsProvidersSubscriptionKimi')}</div>
      ) : null}
      {state.kind === 'github-copilot' ? (
        <div className={styles.providerHint}>{translate('settingsProvidersSubscriptionCopilot')}</div>
      ) : null}
      {definition.riskNoteKey ? (
        <div className={clsx(styles.providerHint, styles.providerRisk)}>
          {translate(definition.riskNoteKey)}
        </div>
      ) : null}
      {state.protocol === 'gemini' ? (
        <div className={styles.providerHint}>{translate('settingsProvidersToolUnsupportedGemini')}</div>
      ) : null}

      <div className={styles.providerModelRow}>
        <div className={styles.providerField}>
          <div className={styles.providerFieldLabel}>{translate('settingsProvidersModel')}</div>
          <input
            className={styles.endpointInput}
            type="text"
            list="provider-model-options"
            value={state.model}
            placeholder={translate('settingsProvidersModelPlaceholder')}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => patch({ model: event.target.value })}
          />
          <datalist id="provider-model-options">
            {state.models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </div>
        <Button variant="outlined" size="m" disabled={fetching} onClick={() => void onFetchModels()}>
          {fetching ? translate('settingsProvidersFetching') : translate('settingsProvidersFetchModels')}
        </Button>
      </div>

      {failure ? <div className={styles.providerError}>{failureText(translate, failure)}</div> : null}

      <div className={styles.providerFormActions}>
        <Button variant="outlined" size="m" onClick={onCancel}>
          {translate('settingsProvidersCancel')}
        </Button>
        <Button variant="primary" size="m" onClick={onSave}>
          {translate('settingsProvidersSave')}
        </Button>
      </div>
    </div>
  )
}
