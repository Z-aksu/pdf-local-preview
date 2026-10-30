# Blur Lock Screen Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 PDF 根目录初始化 `.pdf/config.json`，开启 `blurLockScreen` 时失焦立即遮住阅读内容，并使用保留在本地配置中的密码解锁。

**Architecture:** Express 创建时初始化配置，默认 `blurLockScreen: false`、`lockPassword: ""`。已有字段和未知配置保持不变，配置完整时不重新写文件；格式错误时停止启动并指出文件路径。浏览器只取得开关、是否设置密码和工作区标识，密码通过服务端 POST 校验。Vue 使用独立焦点状态控制器及原生模态对话框，隐藏并禁止操作底层界面，保留阅读组件和位置。

**Tech Stack:** Node.js fs/crypto、Express、Vue 3、HTML dialog、node:test。

---

### Task 1: 配置初始化和服务端接口

- 新增 `server/config.js` 和 `test/config.test.js`，覆盖目录/文件创建、默认空密码、重复启动不改写、补齐字段、手动密码和错误配置保留。
- 在 `server/app.js` 初始化配置；提供不包含密码的 `GET /api/config` 和 `POST /api/unlock`，禁止缓存配置和解锁响应。
- 扩展 `test/app.test.js`、`test/cli.test.js`，验证密码成功/失败、配置不泄漏、CLI 按 `--dir` 初始化配置。

### Task 2: 焦点锁定状态

- 新增 `src/blur-lock.js`、`test/blur-lock.test.js`，覆盖窗口失焦、页面隐藏、配置加载前失焦、禁用开关和解除事件监听。
- 按工作区在 sessionStorage 中保存锁定标记，确保刷新和返回页面仍需解锁；存储不可用时继续在内存中锁屏。
- 异步校验期间再次失焦时保持锁定，窗口恢复焦点不自动解锁。

### Task 3: 阅读界面接入

- 新增 `src/components/LockScreen.vue`，提供密码输入、错误提示、加载失败重试，阻止 Escape 关闭。
- 修改 `src/App.vue`、`src/style.css`：配置读取完成前遮挡界面，锁定时隐藏内容/文件名并阻止快捷键，使用模态对话框覆盖全屏，解锁后保留页签与阅读位置。
- 更新 `README.md`、`.gitignore`、`.npmignore`，说明默认开关、密码位置、手动修改后重启、浏览器焦点触发范围。

### Task 4: 验证

- 先运行新增测试并确认覆盖未实现的行为，再完成对应实现。
- 执行 `npm run build`、`npm test`、`npm pack --dry-run`。
- 浏览器验证失焦、切换标签页、正确/错误密码、刷新、禁用开关及全屏锁定；检查配置完整时再次启动不改变密码或文件内容。

### 后续要求

- 用户要求遮挡页更美观，并进一步明确主题应匹配阅读器原有的米色纸张、深绿和朱红配色，不显示“工作台、工作编号、锁屏、解锁、密码”或锁头。最终界面仅呈现日期、时间和月历；默认隐藏输入框，直接键入密码并按 Enter 恢复，也可点击时间数字显示无可见标签的输入框和箭头按钮。
- 用户要求在启动控制台打印当前配置中的实际解锁密码，包括已有的自定义密码；浏览器配置接口仍不返回密码。
- 用户进一步要求首次初始化留空密码，不再随机生成。手动设置非空密码后才显示密码输入并校验，启动时也只在存在非空密码时打印密码行。
- 用户最终要求点击时间数字恢复阅读：空密码时直接恢复，设置密码时显示输入框并聚焦；移除旧的空白点击区域和三点按钮，保留时钟外观及键盘操作。

### 验证结果

- `npm run build` 成功；`npm test` 的 110 项测试全部通过。
- Chrome 验证通过：浏览器焦点变化、返回仍锁定、错误/正确密码、直接键入与退格、专注模式、原生全屏、刷新、异步校验期间再次失焦、禁用开关、配置读取失败重试和移动端输入。
- 空密码验证通过：没有密码输入框，点击时间数字即可恢复，刷新后仍能通过点击恢复。
- 时间入口验证通过：有密码时点击或键盘激活时间会展开并聚焦输入框，Esc 可收起；无密码时点击或键盘激活时间直接恢复，其他区域不会触发；配置未就绪或校验期间时间入口禁用。桌面和移动端外观检查通过。
- `npm pack --dry-run --ignore-scripts --json` 成功，运行时配置不进入分发文件。
