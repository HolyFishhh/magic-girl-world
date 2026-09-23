/** Shared authoring, display and execution contract for holder-local status selection. */
export interface StatusActionSpec {
    mode: 'remove' | 'copy' | 'transfer';
    from: 'self' | 'opponent';
    to?: 'self' | 'opponent';
    pick?: 'choose' | 'first' | 'random';
    count?: number | 'all';
    stacks?: number;
    filter?: {
        type?: 'buff' | 'debuff' | 'neutral';
        ids?: string[];
        tags?: string[];
        min_stacks?: number;
    };
}
export declare const STATUS_ACTION_CONTRACT = "\u72B6\u6001\u9009\u62E9/\u590D\u5236/\u8F6C\u79FB\u4F7F\u7528 {status_action:{mode:\"remove\"|\"copy\"|\"transfer\",from:\"self\"|\"opponent\",to?:\"self\"|\"opponent\",pick?:\"choose\"|\"first\"|\"random\",count?:1..999\u6216\"all\",stacks?:1..999,filter?:{type?:\"buff\"|\"debuff\"|\"neutral\",ids?:[\u72B6\u6001ID],tags?:[\u6807\u7B7EID],min_stacks?:\u6B63\u6574\u6570}}\u3002from \u6307\u5F53\u524D\u7CBE\u786E\u6301\u6709\u8005\u6216\u5F53\u524D\u5BF9\u65B9\uFF0C\u4E0D\u63A5\u53D7\u7FA4\u4F53 targets\uFF1B\u53EC\u5524\u81EA\u5DF1\u7684 self \u4ECD\u662F\u8BE5\u53EC\u5524\u3002\u590D\u5236/\u8F6C\u79FB\u5FC5\u586B to\uFF1Bremove \u4E0D\u5199 to\uFF1B\u4E0D\u80FD\u5411\u81EA\u5DF1\u8F6C\u79FB\u3002count \u9ED8\u8BA41\uFF0C\u5019\u9009\u4E0D\u8DB3\u5904\u7406\u5B9E\u9645\u6570\u91CF\uFF1Bpick \u9ED8\u8BA4 choose\uFF08\u73A9\u5BB6\u624B\u9009\u4E14\u53EF\u53D6\u6D88\uFF0C\u654C\u65B9\u81EA\u52A8\u968F\u673A\uFF09\uFF0Cfirst \u6309\u6301\u6709\u987A\u5E8F\uFF1Bstacks \u7701\u7565\u5904\u7406\u9009\u4E2D\u72B6\u6001\u5168\u90E8\u73B0\u6709\u5C42\u6570\u3002filter \u5B57\u6BB5\u540C\u65F6\u6EE1\u8DB3\uFF0Cids/tags \u5185\u4EFB\u4E00\u5339\u914D\uFF1B\u72B6\u6001\u5B9A\u4E49\u6839 tags \u662F\u53EF\u9009\u4E14\u4E0D\u91CD\u590D\u7684\u82F1\u6587\u6807\u7B7E\u6570\u7EC4\uFF0C\u7C7B\u578B\u4E2D\u6027\u5199 neutral\u3002\u590D\u5236\u4FDD\u7559\u6765\u6E90\uFF0C\u8F6C\u79FB\u4EC5\u6263\u9664\u76EE\u6807\u5B9E\u9645\u63A5\u6536\u7684\u5C42\u6570\uFF1B\u76EE\u6807\u5C42\u6570\u4E0A\u9650\u3001\u4EBA\u5DE5\u5236\u54C1\u6216\u4E0D\u63A5\u6536\u72B6\u6001\u5BFC\u81F4\u672A\u63A5\u6536\u65F6\u4E0D\u4E22\u5931\u6765\u6E90\u3002\u5C42\u6570\u548C\u671F\u9650\u4E0D\u91CD\u65B0\u8BA1\u7B97\uFF1B\u4E0E\u540CID\u72B6\u6001\u5408\u5E76\u65F6\u53D6\u8F83\u957F\u5269\u4F59\u671F\u9650\uFF0C\u65E0\u671F\u9650\u4F18\u5148\uFF1B\u4ECD\u6309\u8BE5\u72B6\u6001\u81EA\u8EAB\u8870\u51CF\u89C4\u5219\u8FD0\u884C\uFF0C\u4E0D\u80FD\u6539\u540D\u4E3A\u529B\u91CF\u7B49\u9884\u8BBE\u3002\u76EE\u6807\u5199\u5165\u3001\u6765\u6E90\u6263\u9664\u5728\u540C\u4E00\u52A8\u4F5C\u4E8B\u52A1\u5185\u5B8C\u6210\uFF0C\u518D\u6267\u884C\u6765\u6E90\u79FB\u9664\u4E0E\u76EE\u6807\u83B7\u5F97/\u53E0\u52A0\u751F\u547D\u5468\u671F\uFF1B\u53D6\u6D88\u6216\u52A8\u4F5C\u5931\u8D25\u56DE\u6EDA\u3002";
export interface SelectableStatus {
    id: string;
    name: string;
    type: string;
    stacks: number;
    duration?: number;
    emoji?: string;
    description?: string;
}
export declare function validateStatusAction(value: unknown): string | null;
export declare function statusMatchesAction(status: SelectableStatus, spec: StatusActionSpec, tags?: readonly string[]): boolean;
export interface StatusReceiveOptions {
    /** Copied metadata is applied before any apply/stack lifecycle runs. */
    copied?: SelectableStatus;
    accepted?(stacks: number): Promise<void>;
}
export declare function copiedStatusDuration(existing: SelectableStatus | undefined, copied: SelectableStatus): number | undefined;
export interface StatusActionPorts {
    read(side: 'self' | 'opponent'): readonly SelectableStatus[];
    tags(id: string): readonly string[];
    random(): number;
    choose(candidates: readonly SelectableStatus[], count: number): Promise<readonly string[] | null>;
    /** Host must preserve holder identity and run lifecycle hooks inside the enclosing action transaction. */
    apply(side: 'self' | 'opponent', status: SelectableStatus, count: number, options: StatusReceiveOptions): Promise<void>;
    remove(side: 'self' | 'opponent', id: string, count: number): Promise<void>;
}
export declare function executeStatusAction(spec: StatusActionSpec, ports: StatusActionPorts, interactive: boolean): Promise<void>;
export declare function describeStatusAction(spec: StatusActionSpec, names?: Record<string, string>, self?: string, opponent?: string): string;
