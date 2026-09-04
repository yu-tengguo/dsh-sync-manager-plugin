// dsh-sync-manager — web half (lazy-CJS bundle, hand-written).
// 注册 设置→插件→插件配置 中的管家卡片（key = sync-manager）。
// 与 host 半通过 /sync/api POST JSON 通信。PAT 只粘贴后存储，绝不回显/上传。

window.__ModuleLoader__.load({
  id: "dsh-sync-manager",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");
    var useState = React.useState;

    function callApi(method, body) {
      return fetch("/sync/api/" + method, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body || {}),
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.ok) {
          var msg = (j && j.error && j.error.message) || "请求失败";
          var e = new Error(msg);
          e.status = (j && j.error && j.error.code) || "unknown";
          throw e;
        }
        return j.data;
      });
    }

    function pretty(d) {
      if (typeof d === "string") return d;
      if (d === null || d === undefined) return "-";
      try { return JSON.stringify(d, null, 2); } catch { return String(d); }
    }

    var sBtn = { margin: "2px 6px 2px 0", cursor: "pointer" };
    var sBox = { padding: "2px 6px", marginRight: 6, boxSizing: "border-box" };
    var sLabel = { fontSize: 12, color: "#888", marginRight: 4 };
    var sPre = { whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 12, marginTop: 8, maxHeight: 260, overflow: "auto", background: "rgba(127,127,127,.12)", padding: 6, borderRadius: 4 };
    var sSec = { marginTop: 8, paddingTop: 6, borderTop: "1px solid rgba(127,127,127,.25)" };

    function row(label, ...children) {
      return React.createElement("div", { style: { margin: "4px 0" } },
        React.createElement("span", { style: sLabel }, label), ...children);
    }
    function checkbox(label, checked, onChange) {
      return React.createElement("label", { style: { fontSize: 12, marginRight: 8 } },
        React.createElement("input", { type: "checkbox", checked: checked, onChange: function (e) { onChange(e.target.checked); } }), " " + label);
    }

    // 安装/删除 输入行（可携带"操作后同步"复选）
    function MutateRow(props) {
      var _a = useState(""), val = _a[0], setVal = _a[1];
      var _b = useState(false), sync = _b[0], setSync = _b[1];
      var text = props.mode === "install" ? "新增插件" : "删除插件";
      var ph = props.mode === "install" ? "dsh-xxx 或 github:owner/repo 或 file:…" : "插件名，如 dsh-ego-browser";
      return row(text,
        React.createElement("input", { style: Object.assign({ width: "46%" }, sBox), placeholder: ph, value: val, onChange: function (e) { setVal(e.target.value); } }),
        checkbox("操作后同步到仓库", sync, setSync),
        React.createElement("button", {
          style: sBtn, disabled: props.busy || !val.trim(),
          onClick: function () {
            var v = val.trim(); setVal("");
            props.onAction(props.mode, v, sync);
          }
        }, props.mode === "install" ? "安装" : "卸载"),
        React.createElement("span", { style: { fontSize: 11, color: "#999" } }, props.note || "")
      );
    }

    function SyncManagerCard(props) {
      var _a = useState({ busy: false, text: "就绪。点「状态」查看管家与凭据，点「同步到 GitHub」把本机插件/skills 备份到你的仓库。" }), s = _a[0], setS = _a[1];
      function run(label, fn) {
        setS({ busy: true, text: label + " …" });
        Promise.resolve().then(fn).then(function (data) {
          setS({ busy: false, text: label + " 完成：\n" + pretty(data) });
        }).catch(function (e) {
          setS({ busy: false, text: label + " 失败：" + (e && e.message ? e.message : e) });
        });
      }
      function onMutate(mode, v, sync) {
        if (mode === "install") {
          run("安装 " + v, function () { return callApi("install", { spec: v, sync: sync }); });
        } else {
          run("卸载 " + v, function () { return callApi("remove", { name: v, sync: sync }); });
        }
      }
      function confirmRun(label, verb, fn) {
        if (!window.confirm("确定要「" + verb + "」？该操作会改动本机 profile/预置/skills。")) return;
        run(label, fn);
      }
      function summary(d) {
        return "本机：npm 插件 " + d.plugins.length + " 个（" + d.plugins.map(function (p) { return p.name + "@" + (p.installed || "?"); }).join(", ") + "）\n预置 " + d.presets.length + " 个；skills " + d.skills.length + " 个\n依赖的凭据/env 名：" + (d.envRefs.join(", ") || "无") + "\n仓库将含文件（估算）：" + d.repoFileCount;
      }

      return React.createElement("div", { style: { width: "100%" } },
        React.createElement("div", { style: { fontWeight: 600, marginBottom: 4 } }, "插件与技能管家"),
        React.createElement("div", { style: { color: "#888", fontSize: 12, marginBottom: 6 } }, "盘点已安装插件与 skills；经 GitHub REST 同步/还原备份仓（dsh-sync-manager）。密钥只在本机，绝不入库。"),

        row("操作",
          React.createElement("button", { style: sBtn, disabled: s.busy, onClick: function () { run("状态", function () { return callApi("status").then(function (d) { return "DSH home: " + d.home + "\n仓库: " + d.repo.owner + "/" + d.repo.repoName + "@" + d.repo.branch + (d.isPrivate ? " (私有)" : " (公开)") + "\n凭据(" + d.tokenEnv + "): " + (d.tokenConfigured ? "已配置" : "未配置") + "\n增删后询问同步: " + (d.askOnChange ? "开" : "关"); }); }); } }, "状态"),
          React.createElement("button", { style: sBtn, disabled: s.busy, onClick: function () { run("盘点", function () { return callApi("snapshot").then(summary); }); } }, "盘点"),
          React.createElement("button", { style: sBtn, disabled: s.busy, onClick: function () { confirmRun("同步到 GitHub", "同步到 GitHub", function () { return callApi("push"); }); } }, "同步到 GitHub"),
          React.createElement("button", { style: sBtn, disabled: s.busy, onClick: function () { run("仓库差异", function () { return callApi("diff").then(function (d) { return "相对仓库：新建 " + d.created + " / 更新 " + d.updated + " / 删除 " + d.deleted + " / 未变 " + d.unchanged + (d.samples.length ? "\n样例: " + d.samples.join(", ") : ""); }); }); } }, "仓库差异"),
          React.createElement("button", { style: sBtn, disabled: s.busy, onClick: function () { confirmRun("还原预览", "查看还原计划", function () { return callApi("restore-preview").then(function (d) { return d.ops.map(function (o) { return "- " + o.kind + (o.name ? " " + o.name : "") + (o.count ? " (" + o.count + " 文件)" : ""); }).join("\n") || "仓库与本机一致，无需操作"; }); }); } }, "还原预览"),
          React.createElement("button", { style: sBtn, disabled: s.busy, onClick: function () { confirmRun("一键还原", "一键还原（装回仓库全部插件/skills）", function () { return callApi("restore"); }); } }, "一键还原"),
          React.createElement("button", { style: sBtn, disabled: s.busy, onClick: function () { confirmRun("一键更新", "按仓库版本更新已装插件", function () { return callApi("update"); }); } }, "一键更新")
        ),

        React.createElement("div", { style: sSec },
          React.createElement(MutateRow, { busy: s.busy, mode: "install", onAction: onMutate, note: "host 改动需重启 GUI 生效；client 刷新即可。" }),
          React.createElement(MutateRow, { busy: s.busy, mode: "remove", onAction: onMutate, note: "" })
        ),

        React.createElement("div", { style: sSec },
          row("GitHub PAT（只存本机）",
            React.createElement(TokenBox, { busy: s.busy, onDone: function (m) { setS({ busy: false, text: m }); } }))
        ),

        React.createElement("pre", { style: sPre }, s.text)
      );
    }

    function TokenBox(props) {
      var _a = useState(""), v = _a[0], setV = _a[1];
      return React.createElement("span", null,
        React.createElement("input", {
          type: "password", placeholder: "ghp_…（绝不上传）", value: v, style: { width: "45%" },
          onChange: function (e) { setV(e.target.value); }
        }),
        React.createElement("button", {
          style: sBtn, disabled: props.busy || !v.trim(),
          onClick: function () {
            var token = v.trim(); setV("");
            callApi("token-set", { value: token }).then(function (d) {
              props.onDone("PAT 已安全存入本机凭据（" + d.tokenEnv + "）。之后可点「同步到 GitHub」。");
            }).catch(function (e) {
              props.onDone("保存失败：" + (e && e.message ? e.message : e));
            });
          }
        }, "保存 PAT")
      );
    }

    function apply(ctx) {
      ctx.slots.inject("settings.plugin.item", function* () {
        yield ctx.slots.register({
          name: "settings.plugin.item",
          key: "sync-manager",
          id: "sync-manager",
          order: 70
        }, SyncManagerCard);
      });
    }

    const inject = ["slots"];
    const name = "sync-manager";
    exports.apply = apply;
    exports.inject = inject;
    exports.name = name;
    return module.exports;
  }
});
