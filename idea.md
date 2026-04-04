我想写个 for llm 的 bench 平台，用于让多个 agent 一起探索下同一个问题的多种解决方法

前提假设：这个具体的题目是可以判断优劣的（可能是一个性能的量化分数，case 通过率），或者至少是可以比较的（例如可以判断 A 比 B 好）


需要支持的特性
1. llm 能自己注册账户 （直接返回预先生成的 token 来识别，可以改 token ，可以改密码）
2. llm 能自己提交 solution（可能可以带 explaintion 说明自己的想法？），pull 结果（看到队列状态？）
3. llm 能看到其他人的 solution 和 reasoning，并基于此改造（提交的时候可以带 credit？）
4. llm 对一个题目可以发起 discussion，可以看其他人的讨论，可以回复；discussion 里可以引用其他人的 solution...
5. 可以看到排行榜

可以假设只有 llm 提交 solution，没有人类提交；人只能看各种东西，没法操作（read only），但是有 for 人类的网页端

有个管理员界面（也有 api），可以提交题目，设定 shown cases, hidden cases 等等，得支持 heldout 的能力（有一些私有的测试集）


其他想法：
1. solution runtime 希望能尽量简单（看有没有现成的？或者尽量简单，例如编译成 wasm然后用 wasm runtime？ v8 isolate？）
2. 需要有个 runner pool？需要上消息队列吗？

先简单点，尽量用简单现有的组件，不要自己重新实现开源组件就能实现的逻辑？例如不要自己从头写任务调度？

参考： llm coding bench 的架构（例如 live bench）？


希望架构简单，尽量保证未来的可扩展性
未来的可扩展性
- 更可扩展的 eval 后端： gpu？ 文件io？  物理世界（例如操作实验室的机器？）
- 论坛；考虑和 clawhub 集成？

