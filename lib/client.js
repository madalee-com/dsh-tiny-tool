
//#region src/client/index.tsx
/**
* dsh-tiny-tool client settings UI.
*
* Registers a settings card in the DSH Settings page that lets users manage
* `exemptTools` and `exemptPrefixes` exception lists.
*/
window.__ModuleLoader__?.load({
	id: "dsh-tiny-tool",
	factory: (require$1) => {
		const React = require$1("react");
		const NS = "tiny-tool-config";
		function getService(ctx, name) {
			if (!ctx) return void 0;
			if (typeof ctx.get === "function") try {
				return ctx.get(name);
			} catch {}
			return ctx[name];
		}
		function tagField(id, label, hint, tags, onAdd, onRemove) {
			return React.createElement("div", { className: "dtt-field" }, React.createElement("div", { className: "dtt-fieldHead" }, React.createElement("label", {
				className: "dtt-label",
				htmlFor: id
			}, label)), hint ? React.createElement("span", { className: "dtt-hint" }, hint) : null, React.createElement("div", { className: "dtt-tags" }, tags.map((tag) => React.createElement("span", {
				key: tag,
				className: "dtt-tag",
				onClick: () => onRemove(tag)
			}, `× ${tag}`)), React.createElement("input", {
				className: "dtt-tagInput",
				placeholder: "add & press Enter",
				onKeyDown: (e) => {
					if (e.key === "Enter" && e.currentTarget.value.trim()) {
						onAdd(e.currentTarget.value.trim());
						e.currentTarget.value = "";
					}
				}
			})));
		}
		function boolField(id, label, hint, value, onChange) {
			return React.createElement("div", { className: "dtt-field" }, React.createElement("div", { className: "dtt-fieldHead" }, React.createElement("label", {
				className: "dtt-label",
				htmlFor: id
			}, label)), React.createElement("input", {
				id,
				className: "dtt-switch",
				type: "checkbox",
				checked: value ?? false,
				onChange: (e) => onChange(e.currentTarget.checked)
			}), hint ? React.createElement("span", { className: "dtt-hint" }, hint) : null);
		}
		const en = {
			title: "Tiny Tool",
			description: "Hide tool descriptions from the system prompt.",
			intro: "Configure which tools and prefixes should keep their full descriptions visible.",
			exemptTools: "Exempt Tools",
			exemptToolsHint: "Exact tool names to keep fully visible.",
			exemptPrefixes: "Exempt Prefixes",
			exemptPrefixesHint: "Tool name prefixes to keep fully visible (e.g. mnemon_).",
			emptyParameters: "Empty Tool Parameters",
			emptyParametersHint: "When enabled, non-exempt tools are sent with empty parameters instead of a trimmed schema.",
			save: "Save",
			saving: "Saving…",
			discard: "Discard",
			unsaved: "Unsaved",
			loading: "Loading…",
			settingsUnavailable: "Settings unavailable (namespace not registered).",
			saveFailed: "Save failed"
		};
		const zh = {
			title: "Tiny Tool",
			description: "隐藏系统提示中的工具描述。",
			intro: "配置哪些工具和前缀应保持完整描述可见。",
			exemptTools: "豁免工具",
			exemptToolsHint: "保持完全可见的确切工具名称。",
			exemptPrefixes: "豁免前缀",
			exemptPrefixesHint: "保持完全可见的工具名前缀（如 mnemon_）。",
			emptyParameters: "清空工具参数",
			emptyParametersHint: "启用后，非豁免工具将以空参数发送，而非精简后的参数 schema。",
			save: "保存",
			saving: "保存中…",
			discard: "取消",
			unsaved: "未保存",
			loading: "加载中…",
			settingsUnavailable: "设置不可用（命名空间未注册）。",
			saveFailed: "保存失败"
		};
		function useActiveLocale(ctx) {
			const localeSvc = getService(ctx, "locale");
			return React.useSyncExternalStore(React.useMemo(() => (cb) => {
				if (localeSvc && typeof localeSvc.subscribe === "function") return localeSvc.subscribe(cb);
				return () => {};
			}, [localeSvc]), () => {
				if (localeSvc && typeof localeSvc.getSnapshot === "function") {
					const snap = localeSvc.getSnapshot();
					const active = snap && snap.active;
					if (typeof active === "string" && active) return active;
				}
				return typeof navigator !== "undefined" ? String(navigator.language || "").slice(0, 2) : "en";
			}, () => "en");
		}
		function makeT(locale) {
			const dict = String(locale || "").startsWith("ru") ? zh : en;
			return (key) => dict[key] || en[key] || key;
		}
		function TinyToolSettingsForm({ t, ctx }) {
			const [draft, setDraft] = React.useState(null);
			const [saved, setSaved] = React.useState(null);
			const [saving, setSaving] = React.useState(false);
			const [err, setErr] = React.useState("");
			const forms = getService(ctx, "configForms");
			const scope = React.useMemo(() => forms && typeof forms.get === "function" ? forms.get(NS) : void 0, [forms]);
			const snapshot = React.useSyncExternalStore(React.useMemo(() => ((cb) => scope ? scope.subscribe(cb) : () => {}), [scope]), React.useCallback(() => scope ? scope.getSnapshot() : { status: "unavailable" }, [scope]), React.useCallback(() => ({ status: "loading" }), []));
			const status = snapshot?.status || "unavailable";
			const writable = snapshot?.writable !== void 0 ? snapshot.writable : true;
			React.useEffect(() => {
				if (status === "unavailable" || !snapshot?.value) return;
				const value = snapshot.value;
				setDraft({
					exemptTools: Array.isArray(value?.exemptTools) ? value.exemptTools : [],
					exemptPrefixes: Array.isArray(value?.exemptPrefixes) ? value.exemptPrefixes : [],
					emptyParameters: typeof value?.emptyParameters === "boolean" ? value.emptyParameters : true
				});
				setSaved({
					exemptTools: Array.isArray(value?.exemptTools) ? value.exemptTools : [],
					exemptPrefixes: Array.isArray(value?.exemptPrefixes) ? value.exemptPrefixes : [],
					emptyParameters: typeof value?.emptyParameters === "boolean" ? value.emptyParameters : true
				});
			}, [status, snapshot]);
			const setField = (key, value) => setDraft((d) => d ? {
				...d,
				[key]: value
			} : {
				exemptTools: value,
				exemptPrefixes: []
			});
			const dirty = !!(draft && saved && (JSON.stringify(draft.exemptTools) !== JSON.stringify(saved.exemptTools) || JSON.stringify(draft.exemptPrefixes) !== JSON.stringify(saved.exemptPrefixes) || draft.emptyParameters !== saved.emptyParameters));
			const blocked = !dirty || saving || !draft || !writable || status !== "ready";
			const save = async () => {
				if (!draft || blocked) return;
				setErr("");
				setSaving(true);
				try {
					const payload = {
						exemptTools: draft.exemptTools,
						exemptPrefixes: draft.exemptPrefixes,
						emptyParameters: draft.emptyParameters
					};
					const sctx = getService(ctx, "settings");
					const svc = sctx ? sctx.settings : void 0;
					const revision = snapshot?.revision ?? void 0;
					if (typeof svc?.update === "function") await svc.update(NS, structuredClone(payload), revision);
					else if (typeof svc?.replace === "function") await svc.replace(NS, structuredClone(payload), revision);
					else throw new Error("native settings service unavailable");
					setSaved({
						exemptTools: payload.exemptTools,
						exemptPrefixes: payload.exemptPrefixes
					});
				} catch (e) {
					setErr(e instanceof Error ? e.message : String(e));
				} finally {
					setSaving(false);
				}
			};
			if (status === "loading" || !draft && !err && status !== "unavailable") return React.createElement("p", { className: "dtt-failed" }, t("loading"));
			if (status === "unavailable") return React.createElement("p", { className: "dtt-failed" }, t("settingsUnavailable"));
			return React.createElement(React.Fragment, null, React.createElement("p", { className: "dtt-hint" }, t("intro")), tagField("dtt-exempt-tools", t("exemptTools"), t("exemptToolsHint"), draft?.exemptTools ?? [], (tag) => setField("exemptTools", [...draft?.exemptTools ?? [], tag]), (tag) => setField("exemptTools", (draft?.exemptTools ?? []).filter((x) => x !== tag))), tagField("dtt-exempt-prefixes", t("exemptPrefixes"), t("exemptPrefixesHint"), draft?.exemptPrefixes ?? [], (tag) => setField("exemptPrefixes", [...draft?.exemptPrefixes ?? [], tag]), (tag) => setField("exemptPrefixes", (draft?.exemptPrefixes ?? []).filter((p) => p !== tag))), boolField("dtt-empty-params", t("emptyParameters"), t("emptyParametersHint"), draft?.emptyParameters ?? true, (v) => setField("emptyParameters", v)), React.createElement("div", { className: "dtt-foot" }, err ? React.createElement("p", { className: "dtt-failed" }, err || t("saveFailed")) : null, React.createElement("button", {
				type: "button",
				className: "dtt-discard",
				disabled: !dirty || saving,
				onClick: () => {
					setDraft(saved);
					setErr("");
				}
			}, t("discard")), React.createElement("button", {
				type: "button",
				className: "dtt-save",
				disabled: blocked,
				onClick: save
			}, t(saving ? "saving" : "save"))));
		}
		function TinyToolCard({ t, open, onOpen, children }) {
			return React.createElement("li", { className: "dtt-card" + (open ? " dtt-cardOpen" : "") }, React.createElement("button", {
				type: "button",
				className: "dtt-head",
				"aria-expanded": open,
				"aria-label": (open ? t("collapse") : t("expand")) + ": " + t("title"),
				onClick: () => onOpen((v) => !v)
			}, React.createElement("span", { className: "dtt-headText" }, React.createElement("span", { className: "dtt-title" }, t("title")), React.createElement("span", { className: "dtt-sub" }, t("description"))), React.createElement("span", { className: "dtt-chevron" + (open ? " dtt-chevronOpen" : "") }, "▾")), React.createElement("div", {
				className: "dtt-body",
				hidden: !open,
				style: open ? void 0 : { display: "none" }
			}, children));
		}
		function TinyToolPluginCard({ ctx }) {
			const [open, setOpen] = React.useState(false);
			const t = makeT(useActiveLocale(ctx));
			return React.createElement(TinyToolCard, {
				t,
				open,
				onOpen: setOpen
			}, React.createElement(TinyToolSettingsForm, {
				t,
				ctx
			}));
		}
		function apply(ctx) {
			const slotsSvc = getService(ctx, "slots");
			if (slotsSvc && typeof slotsSvc.inject === "function") {
				try {
					slotsSvc.inject("settings.plugin.item", () => slotsSvc.register({
						name: "settings.plugin.item",
						key: NS,
						locale: NS,
						inject: () => ({ ctx })
					}, (props) => React.createElement(TinyToolPluginCard, Object.assign({}, props, { ctx }))));
				} catch (err) {
					console.error("[dsh-tiny-tool] settings registration error:", err);
				}
				try {
					slotsSvc.inject("plugins.item", () => slotsSvc.register({
						name: "plugins.item",
						id: NS,
						order: 60,
						label: () => "dsh-tiny-tool",
						inject: () => ({ ctx })
					}, (props) => React.createElement(TinyToolPluginCard, Object.assign({}, props, { ctx }))));
				} catch (err) {
					console.error("[dsh-tiny-tool] plugins.item registration error:", err);
				}
			}
		}
		return {
			apply,
			inject: [
				"slots",
				"locale",
				"configForms"
			]
		};
	}
});
//#endregion


//# sourceMappingURL=client.cjs.map