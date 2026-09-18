# 成长接口（与既有奖励接口共用本地账户）

所有接口同源访问。家长接口需有效 `meow_parent` 会话，孩子接口需 `meow_child` 会话；写入需 `Content-Type: application/json`、`X-Meow-Client: points-pet` 和对应 `X-CSRF-Token`。不得把家长Cookie或CSRF发给大模型。各业务POST需16—100位稳定的 `idempotencyKey`（字母、数字、下划线、短横线）；重复同内容不重复记账，不同内容复用同ID返回409。

## 读取

|接口|用途|
|---|---|
|`GET /api/parent/growth?days=7`|家长档案、完整项目库、待确认、最近100条分类回忆、六类记录分布、旧记录待归类数量|
|`GET /api/growth?days=7`|孩子档案、当前启用目标、待确认、回忆和记录分布；不返回家长审计|
|`GET /api/parent/history?category=health&kind=earn&limit=40`|完整历史按游标分页，带当时规则快照；`category=unclassified`查未归类旧加分|
|`GET /api/history?category=creativity&limit=5`|孩子自己的历史；参数兼容原分页和文字搜索|
|`GET /api/parent/export`|完整记录JSON，包含成长档案、项目、提交、审计和更正；不是恢复接口|

分类：`health/emotion/social/responsibility/learning/creativity`。模式：`preschool/school_basic/school_advanced`。统计是记录分布，不是能力或健康评分。

## 初始化与档案

首次 `POST /api/parent/setup` 在原有口令、密码和名字字段外，**必须提交整数 `age`（3—10）与 `mode`**；可提交 `enrolled`（布尔）和IANA `timeZone`。客户端发送浏览器本地时区；API省略时区则采用UTC，应显式设置家庭实际时区。

`PUT /api/parent/growth/profile` 接收 `age,mode,enrolled,timeZone,expectedRevision`。已有档案必须带读取到的版本。省略某字段保留原值；年龄修改不自动变更模式。旧用户首次补充档案无需版本，不清空原数据。

## 项目表单保存

`PUT /api/parent/growth/tasks` 接收：

```json
{"title":"按清单整理活动用品","category":"responsibility","modes":["school_basic"],"points":2,"condition":"整理事先约定的几件用品，允许家长提醒","assistance":"允许清单、提醒和求助，不自动减分","reasonExample":"今天根据清单检查了水杯和活动用品。","frequency":"daily","dailyLimit":1,"steps":[],"active":true,"archived":false}
```

新建可省略 `id`；修改传原 `id` 和 `expectedRevision`。`points` 为0/1/2/3/5；`dailyLimit` 为1—4。`frequency` 为daily或once。`steps` 是最多12条 `{id,title,points}`；有步骤时强制once，总分由服务端求和。已有记录的项目不能改写步骤，可复制为新ID。

## 家长加分

`POST /api/parent/growth/award`：

```json
{"taskId":"school_basic-health-1","expectedRevision":1,"delta":2,"reason":"今天和家长一起完成了约定的卫生准备","occurredAt":"2026-09-18T09:00:00+08:00","idempotencyKey":"example-growth-award-0001"}
```

`occurredAt` 必须为带时区的有效ISO时间，不接受未来行动（仅允许5分钟时钟误差）。0表示仅记录。改默认分值（非0）需 `scoreReason`。按步骤计分需 `stepId`，不能领取总分或临时改步骤积分。没有taskId时必须传六类之一的 `category` 与具体 `title`，默认依据为＋2；其他分值需要事先约定的调整依据。

## 孩子提交与家长确认

`POST /api/growth/submit` 接收 `taskId,expectedRevision,reason,occurredAt,stepId?,idempotencyKey`。仅学龄模式、当前启用目标可用。`reason` 可为空；不直接加分。

家长通过award接口加上 `submissionId` 确认，并使用提交原本的 `taskId/stepId/occurredAt`。使用提交时的规则快照，不因后续修改规则、暂停或切换模式而临时改变积分。`delta:0`可确认成不加分的记录。

`POST /api/parent/growth/cancel` 接收 `id,reason,idempotencyKey`，处理待确认提交但不改余额。

## 旧记录归类与误录更正

`POST /api/parent/growth/classify` 接收 `recordId,category,reason,idempotencyKey`。只处理未分类的旧earn/observation，不重新加分或修改原始时间。

`POST /api/parent/growth/correct` 接收 `recordId,reason,points,idempotencyKey`。`points` 为更正后的整数分值（0—10000），0 或省略表示撤销。余额只调整新旧分值差额；原流水保留，非零更正创建关联的新记录，继续计入原类别、原日期和项目频次。累计经验不减少，只增加超过此条记录历次已计入经验的部分；已有权益保留。重复请求幂等，同一原记录不能再次更正，可更正替代记录；余额不足时整个事务拒绝。

## 兼容与约束

旧的 `/api/parent/points` 仍为独立兼容接口，保留原数值能力、家长权限与CSRF验证。它不具备新成长规则和分类，新客户端应调用growth/award；不要使用旧接口实现儿童自行加分或惩罚。任意文本是否描述同一现实行动无法由服务自动判定，家长需避免跨项目重复登记。

幂等请求、余额、经验、记录、目标完成状态和待确认处理共用SQLite事务。项目/档案PUT使用乐观版本校验。HTTP400表示字段/条件不完整，401/403表示会话或权限问题，409表示版本、频次或已处理冲突。不要通过不断更换ID绕过冲突，应让家长核对记录。

自定义单次行动（不传 taskId）必须提供非空 title，reason 可省略或为空；此时流水 reason 使用 title。自定义分值不要求 scoreReason。使用 taskId 的项目仍要求具体 reason，调整其默认分值时仍要求 scoreReason。

日常加分已移除完成时的帮助和条件确认复选框，award 不再要求或保存这两项。旧客户端传入 assistance/basisConfirmed 时仅作兼容忽略，历史快照保留。
