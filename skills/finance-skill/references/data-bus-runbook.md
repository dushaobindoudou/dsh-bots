# data-bus-runbook — finance_search 委派检索手册

> 本文件是 **finance-skill 的数据获取大脑**。两种角色读它：
> ① 主 agent 做单点查询时的命令速查；② **被委派的检索 subagent** 做多步取数时的执行手册（模拟 WorkBuddy domain_search 的远端 agent：一句意图进来，自主拆步骤、多工具调用、返回合成摘要）。

## 数据工具

唯一数据原语：`python3 <skill目录>/scripts/data_bus.py <子命令> [参数]`，输出紧凑 JSON（`{ok, data|error, meta:{source, fetched_at}}`）。akshare 未覆盖或失败时用 web_search/web_fetch 兜底并标注"非一手来源"。

## 数据通道（2026-10 实测）

| 通道 | 覆盖 | 状态 |
|---|---|---|
| 腾讯行情（quote/kline/index/etf） | A股/港股/美股/指数/ETF 报价+历史K线 | 主通道；港美股按延时行情处理，核对返回时间 |
| 新浪财务（financial，经 akshare） | 沪深三表+财务指标 | 依赖 akshare 与上游接口；空表或异常必须报告失败 |
| 东财（fundflow/news/board/lhb，经 akshare） | 资金流/个股新闻/板块/龙虎榜 | ⚠️ 本机网络对 push2.eastmoney.com 连接重置，**失败一次即降级**（web_search 兜底），勿反复重试 |
| call 逃生舱 | 任意 akshare 函数 | 同上，东财类接口受限时换新浪/腾讯类函数或 web_search |

## 子命令速查

| 子命令 | 关键参数 | 返回 | 说明 |
|---|---|---|---|
| `search --name X` | `--market a\|hk\|us` `--all`（含权证/牛熊证） | 公司中文名/英文名/简称/拼音 → 数据源给出的代码（quote_code 可直接用） | **只知道公司名时先跑这个**；没有命中＝“未查到”，不等于未上市；禁止扫号段猜代码 |
| `normalize --code X` | 600519 / 00700.HK / AAPL | 市场路由+各接口代码形态 | **任何标的先跑这个** |
| `quote --code X` | — | 实时行情/盘口 | A股/港股轻量报价；美股从 K 线附带报价读取，标注延时或非实时。`market_cap` 为总市值（现价×总股本，已与数据源交叉校验，无法校验时为 null）；`amount` 是当日成交额，**不是市值** |
| `kline --code X` | --period day/week/month（兼容 daily/weekly/monthly） --start --end --adjust qfq/hfq --limit N | OHLCV+涨跌幅 | 默认前复权、最近 30 根；美股自动尝试腾讯 .OQ/.N/无后缀；请求口径无数据时报告失败，不偷换周期或复权 |
| `financial --code X` | --statement income/balance/cashflow/indicator | 三大报表或财务指标 | indicator=近3年财务指标（推荐先查）；三表仅沪深，报表科目名以返回为准 |
| `fundflow --code X` | --limit N | 主力/超大单资金流 | 仅 A 股；**北向个股级数据 2024-08 起停止披露**，勿再查北向个股 |
| `news --code X` | --limit N | 标题/内容/发布时间/来源 | 仅 A 股；港美股用 web_search |
| `etf [--code X]` | --limit N | ETF 行情/规模快照 | 不带 code 返回全市场头部 |
| `index --code X` | 000001 上证、399001 深成、399006 创业板、000300 沪深300 | 指数日线 | 默认最近 10 根 |
| `board` | --limit N | 东财行业板块行情+涨跌幅 | 板块异动/轮动第一站 |
| `lhb` | --start --end | 龙虎榜明细（营业部/涨跌幅） | 龙虎榜博弈、游资动向 |
| `call <ak_func> --kwargs '{...}'` | 任意 akshare 函数 | 原样 DataFrame→JSON | 逃生舱：两融 `stock_margin_sse`/`stock_margin_szse`、港股通 `stock_hsgt_individual_em`、解禁 `stock_restricted_release_queue_em`、分红 `stock_fhps_detail_em`、回购 `stock_repurchase_em`、宏观 `macro_china_*` 系列 |

## 意图 → 步骤路由（subagent 多步检索模式）

拿到"一句话意图"后自主规划，典型模板（按需取舍，不要机械全跑）：

- **只有公司名（如“MiniMax”“智谱”）**：search --name → 用返回的 quote_code 跑 normalize/quote；search 未命中时换中文全称/英文名/拼音再试一次，仍无结果就报告“未查到（已尝试：…）”
- **个股初探/整体情况**：normalize → quote → kline(--limit 120，看趋势与分位) → financial --statement indicator → fundflow --limit 5 → news --limit 5
- **估值贵不贵**：kline(拉 PE 需 financial+行情自行计算) → financial indicator（PE/PB/ROE 历史序列）→ 横向加 1-2 家可比公司同样步骤
- **财报分析**：financial 三表（income/balance/cashflow --limit 8 期）→ financial indicator（同比环比）→ news（业绩解读）
- **资金面/龙虎榜**：fundflow → lhb(--start 近5日) → board（板块资金环境）
- **大盘/板块轮动**：index（多指数）→ board → lhb → news
- **分红/回购/解禁**：call stock_fhps_detail_em / stock_repurchase_em / stock_restricted_release_queue_em
- **港美股**：normalize → kline（美股标注延时）→ financial 降级为 call 或 web_search（港股财报可 `call stock_hk_financial_sina` 试）

## 避坑清单（实测要点）

1. **复权口径**：趋势/技术面用 `--adjust qfq`（前复权）；财务收益核算用 hfq 或不复权并注明；不注明口径的涨幅结论无效
2. **代码格式**：港股必须 5 位（00700）；美股保留份额类别（BRK.B），腾讯路由自动试后缀；北交所 4/8/920 开头，显式 .BJ/.SH/.SZ 优先，三表接口不支持
3. **财报时效**：新浪三表按披露日期滞后更新；indicator 的报告期是期末值。回答"最新一期"时核对 `报告期` 字段与当前日期的差距，超 1 个季度未更新要说明
4. **接口易变**：akshare 上游（东财/新浪）偶发改名限流；报错先重试一次，再换 `call` 用近义函数，最后 web_search 兜底——**每次失败都要在结果里说明降级原因**
5. **查不到≠不存在**：search 无命中、某代码无行情、web_search 没搜到，都只能说“未查到”并列出已尝试的检索词/代码，**不得据此断言“未上市/不存在/概念阶段”**，也不得用穷举号段的方式猜代码。
6. **限频**：同一子命令批量查多标的时串行调用、间隔 1s；`quote`/`etf` 全表接口一次调用可过滤多标的，不要循环单查
7. **单位与口径**：quote 的 currency/amount_unit/volume_unit 是准则：A 股成交额 amount 为 CNY（amount_wan 为万元），成交量 volume 为手；港股 amount 为港元、volume 为股；港美股不输出未经核实的 A 股涨跌停/市净率字段。资金流"主力净流入"含超大单+大单；指标字段名以返回 JSON 为准，禁止脑补字段名

## 返回契约（subagent → 主 agent）

合成摘要必须自包含、可直接进主 agent 上下文，结构：

1. **一句话结论**（直接回答意图，含置信度）
2. **关键数据**：紧凑表格或要点，**每个数字带 来源（akshare:<func>）+ 时点**；多来源/多周期分开标注
3. **异常与缺口**：哪些步骤失败、降级到什么来源、数据截止到哪天
4. **值得主 agent 深挖的线索**（可选，≤3 条）：如"毛利率连续 3 季下滑，建议横向对比竞对"

禁止：复述原始 JSON 全文；输出未经验证的推断当数据；省略时点。

## 运行与错误判断

- Python 3.9+；quote/kline/index 不依赖第三方 Python 包。financial/fundflow/news 等先安装 `python3 -m pip install -r <skill目录>/requirements.txt`，所有 Bot 使用同一个可用解释器。
- 退出码 0 且 JSON `ok=true` 才算成功；`ok=false`、空表、无请求周期或无请求复权数据均不能用作已获取数据。错误输出提供降级提示。
- `meta.fetched_at` 是带北京时间偏移的抓取时间；`data.timestamp`/K 线 `date` 是数据时间，二者不同。港美股报价 `quote_type=delayed`；禁止称为实时。
- Tencent 是第三方聚合源；原始 API 时间和字段必须保留。财务分析核对报告期，以公司公告/交易所披露为准。
- 不再把其他周期/不复权 K 线伪装成请求周期/前复权。失败后可显式请求 `--adjust none` 并在结果中说明变更。
