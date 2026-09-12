/**
 * dsh-tiny-tool client settings UI.
 *
 * Registers a settings card in the DSH Settings page that lets users manage
 * `exemptTools` and `exemptPrefixes` exception lists.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.__ModuleLoader__?.load({
    id: 'dsh-tiny-tool',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    factory: (require) => {
        const React = require('react');
        const NS = 'tiny-tool-config';
        // ─── helpers ────────────────────────────────────────────────────────────
        function getService(ctx, name) {
            if (!ctx)
                return undefined;
            if (typeof ctx.get === 'function') {
                try {
                    return ctx.get(name);
                }
                catch { /* ignore */ }
            }
            const anyCtx = ctx;
            return anyCtx[name];
        }
        function valueField(id, label, hint, value, onEdit) {
            return React.createElement('div', { className: 'dtt-field' }, React.createElement('div', { className: 'dtt-fieldHead' }, React.createElement('label', { className: 'dtt-label', htmlFor: id }, label)), React.createElement('input', {
                id,
                className: 'dtt-input',
                type: 'text',
                value: value ?? '',
                onChange: (e) => onEdit(e.currentTarget.value),
            }), hint ? React.createElement('span', { className: 'dtt-hint' }, hint) : null);
        }
        function tagField(id, label, hint, tags, onAdd, onRemove) {
            return React.createElement('div', { className: 'dtt-field' }, React.createElement('div', { className: 'dtt-fieldHead' }, React.createElement('label', { className: 'dtt-label', htmlFor: id }, label)), hint ? React.createElement('span', { className: 'dtt-hint' }, hint) : null, React.createElement('div', { className: 'dtt-tags' }, tags.map((tag) => React.createElement('span', {
                key: tag,
                className: 'dtt-tag',
                onClick: () => onRemove(tag),
            }, `× ${tag}`)), React.createElement('input', {
                className: 'dtt-tagInput',
                placeholder: 'add & press Enter',
                onKeyDown: (e) => {
                    if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                        onAdd(e.currentTarget.value.trim());
                        e.currentTarget.value = '';
                    }
                },
            })));
        }
        const en = {
            title: 'Tiny Tool',
            description: 'Hide tool descriptions from the system prompt.',
            intro: 'Configure which tools and prefixes should keep their full descriptions visible.',
            exemptTools: 'Exempt Tools',
            exemptToolsHint: 'Exact tool names to keep fully visible (e.g. tool_describe).',
            exemptPrefixes: 'Exempt Prefixes',
            exemptPrefixesHint: 'Tool name prefixes to keep fully visible (e.g. mnemon_).',
            save: 'Save',
            saving: 'Saving…',
            discard: 'Discard',
            unsaved: 'Unsaved',
            loading: 'Loading…',
            settingsUnavailable: 'Settings unavailable (namespace not registered).',
            saveFailed: 'Save failed',
        };
        const zh = {
            title: 'Tiny Tool',
            description: '隐藏系统提示中的工具描述。',
            intro: '配置哪些工具和前缀应保持完整描述可见。',
            exemptTools: '豁免工具',
            exemptToolsHint: '保持完全可见的确切工具名称（如 tool_describe）。',
            exemptPrefixes: '豁免前缀',
            exemptPrefixesHint: '保持完全可见的工具名前缀（如 mnemon_）。',
            save: '保存',
            saving: '保存中…',
            discard: '取消',
            unsaved: '未保存',
            loading: '加载中…',
            settingsUnavailable: '设置不可用（命名空间未注册）。',
            saveFailed: '保存失败',
        };
        function useActiveLocale(ctx) {
            const localeSvc = getService(ctx, 'locale');
            return React.useSyncExternalStore(React.useMemo(() => (cb) => {
                if (localeSvc && typeof localeSvc.subscribe === 'function')
                    return localeSvc.subscribe(cb);
                return () => { };
            }, [localeSvc]), () => {
                if (localeSvc && typeof localeSvc.getSnapshot === 'function') {
                    const snap = localeSvc.getSnapshot();
                    const active = snap && snap.active;
                    if (typeof active === 'string' && active)
                        return active;
                }
                return typeof navigator !== 'undefined' ? String(navigator.language || '').slice(0, 2) : 'en';
            }, () => 'en');
        }
        function makeT(locale) {
            const dict = String(locale || '').startsWith('ru') ? zh : en;
            return (key) => dict[key] || en[key] || key;
        }
        function TinyToolSettingsForm({ t, ctx }) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const [draft, setDraft] = React.useState(null);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const [saved, setSaved] = React.useState(null);
            const [saving, setSaving] = React.useState(false);
            const [err, setErr] = React.useState('');
            const scope = React.useMemo(() => {
                const svc = getService(ctx, 'settingsScope');
                return svc && typeof svc.bind === 'function' ? svc.bind({ namespace: NS }) : undefined;
            }, [ctx]);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const snapshot = React.useSyncExternalStore(React.useMemo(() => (cb) => (scope ? scope.subscribe(cb) : () => { }), [scope]), React.useCallback(() => (scope ? scope.getSnapshot() : { status: 'ready' }), [scope]), React.useCallback(() => ({ status: 'loading' }), []));
            const status = snapshot?.status || 'ready';
            const writable = snapshot?.writable !== undefined ? snapshot.writable : true;
            // Load initial config from REST endpoint if available
            React.useEffect(() => {
                if (status === 'unavailable')
                    return;
                let alive = true;
                fetch('/dsh-tiny-tool/config', { cache: 'no-store' })
                    .then((res) => res.json())
                    .then((data) => {
                    if (!alive)
                        return;
                    const exemptTools = Array.isArray(data.exemptTools) ? data.exemptTools : [];
                    const exemptPrefixes = Array.isArray(data.exemptPrefixes) ? data.exemptPrefixes : [];
                    setSaved({ exemptTools, exemptPrefixes });
                    setDraft({ exemptTools, exemptPrefixes });
                })
                    .catch((e) => { if (alive)
                    setErr(String(e instanceof Error ? e.message : e)); });
                return () => { alive = false; };
            }, [status]);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const setField = (key, value) => setDraft((d) => d ? { ...d, [key]: value } : { exemptTools: value, exemptPrefixes: [] });
            const dirty = !!(draft && saved && (JSON.stringify(draft.exemptTools) !== JSON.stringify(saved.exemptTools) ||
                JSON.stringify(draft.exemptPrefixes) !== JSON.stringify(saved.exemptPrefixes)));
            const blocked = !dirty || saving || !draft || !writable || status !== 'ready';
            const save = async () => {
                if (!draft || blocked)
                    return;
                setErr('');
                setSaving(true);
                try {
                    const payload = { exemptTools: draft.exemptTools, exemptPrefixes: draft.exemptPrefixes };
                    // Try settingsScope first
                    if (scope && typeof scope.set === 'function') {
                        const broken = [];
                        try {
                            await scope.set('exemptTools', payload.exemptTools);
                        }
                        catch (e) {
                            broken.push('exemptTools: ' + (e instanceof Error ? e.message : String(e)));
                        }
                        try {
                            await scope.set('exemptPrefixes', payload.exemptPrefixes);
                        }
                        catch (e) {
                            broken.push('exemptPrefixes: ' + (e instanceof Error ? e.message : String(e)));
                        }
                        if (broken.length)
                            throw new Error(broken.join('; '));
                    }
                    // Fallback to REST
                    const res = await fetch('/dsh-tiny-tool/config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok)
                        throw new Error((data && data.error && data.error?.message) || ('HTTP ' + res.status));
                    setSaved({ exemptTools: payload.exemptTools, exemptPrefixes: payload.exemptPrefixes });
                }
                catch (e) {
                    setErr(e instanceof Error ? e.message : String(e));
                }
                finally {
                    setSaving(false);
                }
            };
            if (status === 'loading' || (!draft && !err && status !== 'unavailable')) {
                return React.createElement('p', { className: 'dtt-failed' }, t('loading'));
            }
            if (status === 'unavailable') {
                return React.createElement('p', { className: 'dtt-failed' }, t('settingsUnavailable'));
            }
            return React.createElement(React.Fragment, null, React.createElement('p', { className: 'dtt-hint' }, t('intro')), tagField('dtt-exempt-tools', t('exemptTools'), t('exemptToolsHint'), draft?.exemptTools ?? [], (tag) => setField('exemptTools', [...(draft?.exemptTools ?? []), tag]), (tag) => setField('exemptTools', (draft?.exemptTools ?? []).filter((x) => x !== tag))), tagField('dtt-exempt-prefixes', t('exemptPrefixes'), t('exemptPrefixesHint'), draft?.exemptPrefixes ?? [], (tag) => setField('exemptPrefixes', [...(draft?.exemptPrefixes ?? []), tag]), (tag) => setField('exemptPrefixes', (draft?.exemptPrefixes ?? []).filter((p) => p !== tag))), React.createElement('div', { className: 'dtt-foot' }, err ? React.createElement('p', { className: 'dtt-failed' }, err || t('saveFailed')) : null, React.createElement('button', {
                type: 'button',
                className: 'dtt-discard',
                disabled: !dirty || saving,
                onClick: () => { setDraft(saved); setErr(''); },
            }, t('discard')), React.createElement('button', {
                type: 'button',
                className: 'dtt-save',
                disabled: blocked,
                onClick: save,
            }, t(saving ? 'saving' : 'save'))));
        }
        // ─── card wrapper ────────────────────────────────────────────────────────
        function TinyToolCard({ t, open, onOpen, children }) {
            return React.createElement('li', { className: 'dtt-card' + (open ? ' dtt-cardOpen' : '') }, React.createElement('button', {
                type: 'button',
                className: 'dtt-head',
                'aria-expanded': open,
                'aria-label': (open ? t('collapse') : t('expand')) + ': ' + t('title'),
                onClick: () => onOpen((v) => !v),
            }, React.createElement('span', { className: 'dtt-headText' }, React.createElement('span', { className: 'dtt-title' }, t('title')), React.createElement('span', { className: 'dtt-sub' }, t('description'))), React.createElement('span', { className: 'dtt-chevron' + (open ? ' dtt-chevronOpen' : '') }, '▾')), React.createElement('div', {
                className: 'dtt-body',
                hidden: !open,
                style: open ? undefined : { display: 'none' },
            }, children));
        }
        // ─── root component ──────────────────────────────────────────────────────
        function TinyToolPluginCard({ ctx }) {
            const [open, setOpen] = React.useState(false);
            const locale = useActiveLocale(ctx);
            const t = makeT(locale);
            return React.createElement(TinyToolCard, { t, open, onOpen: setOpen }, React.createElement(TinyToolSettingsForm, { t, ctx }));
        }
        // ─── apply ────────────────────────────────────────────────────────────────
        function apply(ctx) {
            const slotsSvc = getService(ctx, 'slots');
            if (slotsSvc && typeof slotsSvc.inject === 'function') {
                try {
                    slotsSvc.inject('settings.plugin.item', () => slotsSvc.register({
                        name: 'settings.plugin.item',
                        key: NS,
                        locale: NS,
                        inject: () => ({ ctx }),
                    }, (props) => React.createElement(TinyToolPluginCard, Object.assign({}, props, { ctx }))));
                }
                catch (err) {
                    console.error('[dsh-tiny-tool] settings registration error:', err);
                }
            }
        }
        module.exports = { apply, inject: ['slots', 'locale', 'settingsScope'] };
        return module.exports;
    },
});
export {};
//# sourceMappingURL=index.js.map