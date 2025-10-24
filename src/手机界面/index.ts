import "./index.css";

// 聊天界面
import chat_char_msg from "./chat/chat_char_msg.html";
import chat_voice_message from "./chat/chat_char_voice_message.html";
import chat_emoji_message from "./chat/chat_emoji_message.html";
import chat_fakeimg_message from "./chat/chat_fakeimg_message.html";
import chat_head_css from "./chat/chat_head.css?raw";
import chat_list_item from "./chat/chat_list_item.html";
import chat_music_message from "./chat/chat_music_message.html";
import chat_myvoice_message from "./chat/chat_my_voice_message.html";
import chat_normal_message from "./chat/chat_normal_message.html";
import chat_page from "./chat/chat_page.html";
import chat_page_setting from "./chat/chat_page_setting.html";
import chat_transfer_message from "./chat/chat_transfer_message.html";
import chat_user_message from "./chat/chat_user_message.html";
// 动态空间
import moment_page from "./moment/moment_page.html";
import space_contents from "./moment/space_contents.html";

// 表情包列表，按用户提供的内容
const emojiList = [
  { name: "不开心", url: "https://gitgud.io/lolodesu/lolobabytutorial/-/raw/master/lologame/表情包/不开心.png" },
  { name: "不理解", url: "https://gitgud.io/lolodesu/lolobabytutorial/-/raw/master/lologame/表情包/不理解.png" },
  { name: "不要难过", url: "https://gitgud.io/lolodesu/lolobabytutorial/-/raw/master/lologame/表情包/不要难过.png" },
  { name: "做饭", url: "https://gitgud.io/lolodesu/lolobabytutorial/-/raw/master/lologame/表情包/做饭.png" },
  { name: "困倦", url: "https://gitgud.io/lolodesu/lolobabytutorial/-/raw/master/lologame/表情包/困倦.png" },
  { name: "大笑", url: "https://gitgud.io/lolodesu/lolobabytutorial/-/raw/master/lologame/表情包/大笑.png" },
  { name: "天气好热", url: "https://gitgud.io/lolodesu/lolobabytutorial/-/raw/master/lologame/表情包/天气好热.png" },
  { name: "害羞", url: "https://gitgud.io/lolodesu/lolobabytutorial/-/raw/master/lologame/表情包/害羞.png" },
  { name: "开心", url: "https://gitgud.io/lolodesu/lolobabytutorial/-/raw/master/lologame/表情包/开心.png" },
  { name: "想你", url: "https://gitgud.io/lolodesu/lolobabytutorial/-/raw/master/lologame/表情包/想你.png" },
  { name: "想吃饭", url: "https://gitgud.io/lolodesu/lolobabytutorial/-/raw/master/lologame/表情包/想吃饭.png" },
  { name: "愉快", url: "https://gitgud.io/lolodesu/lolobabytutorial/-/raw/master/lologame/表情包/愉快.png" },
  { name: "拥抱", url: "https://gitgud.io/lolodesu/lolobabytutorial/-/raw/master/lologame/表情包/拥抱.png" },
  { name: "期待", url: "https://gitgud.io/lolodesu/lolobabytutorial/-/raw/master/lologame/表情包/期待.png" },
  { name: "爱你", url: "https://gitgud.io/lolodesu/lolobabytutorial/-/raw/master/lologame/表情包/爱你.png" },
  { name: "疑问", url: "https://gitgud.io/lolodesu/lolobabytutorial/-/raw/master/lologame/表情包/疑问.png" },
  { name: "蹭蹭手", url: "https://gitgud.io/lolodesu/lolobabytutorial/-/raw/master/lologame/表情包/蹭蹭手.png" },
  { name: "逃跑", url: "https://gitgud.io/lolodesu/lolobabytutorial/-/raw/master/lologame/表情包/逃跑.png" },
  { name: "震惊", url: "https://gitgud.io/lolodesu/lolobabytutorial/-/raw/master/lologame/表情包/震惊.png" }
];

interface ChatCharSetting {
  name: string;
  style: {
    气泡颜色: string;
    聊天壁纸: string;
  };
}

class MyINI {
  public sections: Record<string, any>;
  public autoSave: string;
  public save: any;

  constructor() {
    this.sections = {};
    this.autoSave = "";
  }

  loadLines(lines: string[]) {
    this.sections = {};
    let currentSection = "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        currentSection = trimmed.slice(1, -1);
      } else if (currentSection && trimmed.includes("=")) {
        const [key, ...values] = trimmed.split("=");
        const value = values.join("=").trim();

        if (!this.sections[currentSection]) {
          this.sections[currentSection] = {};
        }
        this.sections[currentSection][key.trim()] = value;
      }
    }

    return Object.keys(this.sections).length > 0;
  }

  loadText(text: string) {
    // 添加参数校验
    if (typeof text !== "string") {
      console.error("Invalid text input");
      return false;
    }

    // 处理不同换行符并过滤空行
    const lines = text
      .replace(/\r\n/g, "\n") // 统一换行符
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    console.log("Parsed lines:", lines.length);
    return this.loadLines(lines); // 使用this调用类方法
  }

  getAllSections() {
    return Object.keys(this.sections);
  }

  getAllKeys(section: string) {
    return this.sections[section] ? Object.keys(this.sections[section]) : [];
  }

  readValue(section: string, key: string) {
    return this.sections[section]?.[key] || "";
  }

  readValueDouble(section: string, key: string) {
    const value = parseFloat(this.readValue(section, key));
    return isNaN(value) ? -1 : value;
  }

  writeValue(section: string, key: string, value: any) {
    if (!key) return false;

    if (!this.sections[section]) {
      this.sections[section] = {};
    }
    this.sections[section][key] = value.toString();

    if (this.autoSave) {
      this.save(this.autoSave);
    }
    return true;
  }

  getKeyByValue(section: string, value: any) {
    const items = this.sections[section] || {};
    return Object.keys(items).find((key) => items[key] === value) || "";
  }

  containsKey(section: string) {
    return section in this.sections;
  }

  removeSection(section: string) {
    delete this.sections[section];
    return true;
  }

  getAllText() {
    let result = "";
    for (const section of Object.keys(this.sections)) {
      result += `\n[${section}]`;
      const keyvalue = this.sections[section];
      for (const key of Object.keys(keyvalue)) {
        const value = keyvalue[key];
        result += `\n${key}=${value}`;
      }
    }
    result = result.trim();
    return result;
  }
}

// FIXME: 更好的类型
interface Data {
  私聊: Record<string, any>;
  群聊: Record<string, any>;
}

let random_head_list = new Array();
let QQ_pages = new Array();
let QQ_emoji = new Map();
let QQ_UserHead = new Map();
let QQ_CacheSendMsg = "";
// let QQ_SetNoteName = '';
let QQ_msgjson: Data = {
  私聊: {},
  群聊: {},
};
let QQ_momentjson: { [key: string]: any } = {};
let QQ_NewMsg: { [key: string]: any } = {};
let QQ_Groups: string[] = [];
let gening: boolean;
let worldbook: string;
let entries: LorebookEntry[];
let newgen: boolean = true;
let QQ_CharSettings = new MyINI();
let Phone_Settings = new MyINI();
let QQ_Music = {
  audio: new Audio(),
  lastelement: undefined as JQuery | undefined, // 允许 undefined
  isLoading: false,
  // 新增封面缓存
  cover: ""
};
let QQ_RandomHead: { [key: string]: any }[] = [];
const charAvatarPath = `{{charAvatarPath}}`;
let NpcCssValue = "";
let Variables: { [key: string]: any } = {};;

let User_LastMsgMap: Data = {
  群聊: {},
  私聊: {},
};

let Char_LastMsgMap: Data = {
  群聊: {},
  私聊: {},
};

/**
 * 调用前端助手函数
 */
class ST {
  static async GetCurrentMessages() {
    const CurrentMessageId = getCurrentMessageId();
    const Messages = await getChatMessages(CurrentMessageId);
    if (!Messages) {
      console.log(`获取楼层记录失败`);
      return "";
    }
    let msg = Messages[0].message;
    return msg;
  }

  static async Gen(msg: string) {
    console.log(`触发生成  ${msg}`);
    let result;
    if (newgen) {
      result = await generate({ user_input: msg, should_stream: true });
    } else {
      result = await generate({ user_input: msg, should_stream: false });
    }
    console.log(`生成结果:${result}`);
    return result;
  }
}

/**
 * 获取消息中的名称
 * @param value 消息内容
 * @returns 名称列表
 */
function QQ_GetValueName(value: string) {
  let result = [];
  const lines = value.split(/\r?\n/);
  for (const line of lines) {
    let match = line.match(/在群聊(.+)中发送:(.+)/);
    if (match) {
      let obj = {
        name: match[1],
        value: match[2],
      };
      result.push(obj);
      continue;
    }

    match = line.match(/给(.+)发消息:(.+)/);
    if (match) {
      let obj = {
        name: match[1],
        value: match[2],
      };
      result.push(obj);
      continue;
    }

    match = line.match(/回复(.+):(.+)/);
    if (match) {
      let obj = {
        name: match[1],
        value: match[2],
      };
      result.push(obj);
      continue;
    }
  }

  return result;
}

/**
 * 生成消息
 * @param msg 消息内容
 * @returns 生成结果
 */
async function QQ_Gen(msg: string) {
  console.log(`触发生成  ${msg}`);
  let result;
  if (newgen) {
    result = await generate({ user_input: msg, should_stream: true });
  } else {
    result = await generate({ user_input: msg, should_stream: false });
  }
  console.log(`生成结果:${result}`);
  return result;
}

/**
 * 保存消息
 * @returns
 */
async function QQ_Save_Msg() {
  if (!QQ_msgjson) {
    return;
  }
  const CurrentMessageId = getCurrentMessageId();
  const Messages = await getChatMessages(CurrentMessageId);
  if (!Messages) {
    console.log(`获取楼层记录失败`);
    return;
  }
  let msg = Messages[0].message;
  const match = msg.match(/msg_start[\s\S]+?msg_end/);
  if (!match) {
    console.log(`匹配楼层记录失败`);
    return;
  }
  msg = msg.replace(
    match[0],
    `msg_start\n${YAML.stringify(QQ_msgjson)}\nmsg_end`
  );
  setChatMessage({ message: msg }, CurrentMessageId, { refresh: "none" });
}

// FIXME: 明显 json 的类型可以更准确
/**
 * 删除消息
 * @param json 消息记录
 * @returns
 */
function QQ_Msg_DeletOld(json: Record<string, any>) {
  // 删除私聊的旧内容
  for (const str in json.私聊) {

    const match = str.match(/(.+?)和(.+?)的聊天/);
    if (!match) {
      continue;
    }
    let name = "";
    if (match[1] != `{{user}}`) {
      name = match[1];
    }
    else if (match[2] != `{{user}}`) {
      name = match[2];
    }
    else {
      continue;
    }

    // 先判断有没有消息内容,没有就下一个
    if (json.私聊[str].length == 0) {
      continue;
    }

    // 反向找自己发的最后一条的位置
    let lastSelfMsgIndex = -1;
    for (let i = json.私聊[str].length - 1; i >= 0; i--) {
      let ok = false;
      if (User_LastMsgMap.私聊[name] && json.私聊[str][i].indexOf(User_LastMsgMap.私聊[name]) > -1) {
        ok = true;
      }
      else if (Char_LastMsgMap.私聊[name] && json.私聊[str][i].indexOf(Char_LastMsgMap.私聊[name]) > -1) {
        ok = true;
      }
      if (ok) {
        lastSelfMsgIndex = i;
        break; // 找到最后一条就停止
      }
    }
    if (lastSelfMsgIndex !== -1) {
      json.私聊[str] = json.私聊[str].slice(lastSelfMsgIndex + 1);
      console.log(`删除${name}的重复聊天记录!!!`);
    }
  }

  // 删除群聊的旧内容
  for (const name in json.群聊) {

    // 先判断有没有消息内容,没有就下一个
    if (json.群聊[name].msgs.length == 0) {
      continue;
    }

    // 反向找自己发的最后一条的位置
    let lastSelfMsgIndex = -1;
    for (let i = json.群聊[name].msgs.length - 1; i >= 0; i--) {
      let ok = false;
      if (User_LastMsgMap.群聊[name] && json.群聊[name].msgs[i].indexOf(User_LastMsgMap.群聊[name]) > -1) {
        ok = true;
      }
      else if (Char_LastMsgMap.群聊[name] && json.群聊[name].msgs[i].indexOf(Char_LastMsgMap.群聊[name]) > -1) {
        ok = true;
      }
      if (ok) {
        lastSelfMsgIndex = i;
        break; // 找到最后一条就停止
      }
    }
    if (lastSelfMsgIndex !== -1) {
      json.群聊[name].msgs = json.群聊[name].msgs.slice(lastSelfMsgIndex + 1);
      console.log(`删除${name}的重复聊天记录!!!`);
    }
  }

  // 取char最后一条消息加入到User_LastMsgMap
  for (const name in json.私聊) {
    let length = json.私聊[name].length;
    if (length > 0) {
      Char_LastMsgMap.私聊[name] = json.私聊[name][length - 1];
    }
  }
  for (const name in json.群聊) {
    let length = json.群聊[name].msgs.length;
    if (length > 0) {
      Char_LastMsgMap.群聊[name] = json.群聊[name].msgs[length - 1];
    }
  }

  console.log(`Char_LastMsgMap:\n${JSON.stringify(Char_LastMsgMap)}`);

  return json;
}
// FIXME: 明显 json 的类型可以更准确
/**
 * 删除一条消息
 * @param type 类型
 * @param json 消息记录
 * @returns
 */
// function QQ_MsgDeletOne(type: string, json: Record<string, any>) {
//   const reg = new RegExp('{{user}}--');
//   for (let name in json[type]) {
//     if (type == '群聊') {
//       while (true) {
//         if (json[type][name]['msgs'].length <= 0) {
//           console.log(`数组成员为零,退出循环`);
//           break;
//         }
//         let m = json[type][name]['msgs'][0];
//         if (m.match(reg)) {
//           console.log(`群聊首句是user,删除`);
//           json[type][name]['msgs'].shift();
//         } else {
//           console.log(`非自己发言,退出循环`);
//           break;
//         }
//       }
//     } else if (type == '私聊') {
//       while (true) {
//         if (json[type][name].length <= 0) {
//           break;
//         }
//         let m = json[type][name][0];
//         if (m.match(reg)) {
//           console.log(`私聊首句是user,删除`);
//           json[type][name].shift();
//         } else {
//           console.log(`非自己发言,退出循环`);
//           break;
//         }
//       }
//     }
//   }

//   return json;
// }

/**
 * 按下回车键
 * @param e 事件对象
 * @param element 元素
 */
function QQ_EnterPress(e: JQuery.KeyDownEvent, element: JQuery) {
  if (e.key !== "Enter") {
    return;
  }

  const val = $(element).val();
  if (!val) {
    return;
  }
  let content = val.toString();
  content = QQ_MySendSpecial(content);

  const $closest = $(element.closest(".QQ_chat_page"));
  const $msgContent = $closest.find(".msgcontent");
  const userContent = QQ_Chat_SpecialMsg(content as string, "{{user}}", false, true);
  const html = _.template(chat_user_message)({ content: userContent });
  const name = $closest.attr("data-name") ?? "";
  console.log(`发送文本:${content} 对象:${name}`);

  $msgContent.append(html);
  $msgContent[0].scrollTop = $msgContent[0].scrollHeight;
  $(element).val("");

  if (QQ_Groups.includes(name)) {
    QQ_CacheSendMsg += `\n<本次响应必须遵守线上模式格式>在群聊${name}中发送:${content}`;
  } else {
    QQ_CacheSendMsg += `\n<本次响应必须遵守线上模式格式>给${name}发消息:${content}`;
  }
}

/**
 * 重roll消息
 * @param event 事件对象
 * @returns
 */
async function QQ_Roll(event: JQuery.TriggeredEvent) {
  const result = confirm("确定重roll这条消息吗?");
  if (!result) {
    return;
  }

  // 停止事件传播
  event.stopPropagation();

  if (!event.currentTarget) {
    return;
  }

  const $avatar = $(event.currentTarget);
  console.log("点击的头像元素:", $avatar);

  // 查找父级消息容器
  const $chatMsg = $avatar.closest(".QQ_chat_mymsg");
  if ($chatMsg.length === 0) {
    console.error("未找到消息容器!");
    return;
  }

  // 获取消息内容
  let value;
  const $msgContent = $chatMsg.find(".QQ_chat_msgdiv span").first();
  if ($msgContent.length > 0) {
    value = $msgContent.text();
  }

  // 获取当前消息的索引
  const index = $chatMsg.index();
  console.log(`点击index:${index}`);

  // 获取聊天对象名称
  const $chatPage = $chatMsg.closest('.QQ_chat_page');
  if ($chatPage.length === 0) {
    console.error("未找到聊天页面!");
    return;
  }

  const name = $chatPage.attr("data-name") ?? "";
  console.log("聊天对象:", name);

  console.log(`删除前的记录:${YAML.stringify(QQ_msgjson)}`);
  if (QQ_Groups.includes(name)) {
    if (QQ_msgjson.群聊[name].msgs.length > index) {
      const sp = QQ_msgjson.群聊[name].msgs[index].split("--");
      if (sp.length >= 2) {
        value = sp[1];
      }
    }
    QQ_msgjson.群聊[name].msgs.length = index;
  } else {
    const key = `{{user}}和${name}的聊天`
    if (QQ_msgjson.私聊[key].length > index) {
      const sp = QQ_msgjson.私聊[key][index].split("--");
      if (sp.length >= 2) {
        value = sp[1];
      }
    }
    QQ_msgjson.私聊[key].length = index;
  }

  console.log(`删除后的记录:${YAML.stringify(QQ_msgjson)}`);

  // 删除后面所有消息内容
  $chatMsg.nextAll().remove();

  await QQ_Save_Msg();
  QQ_SendMsg(event, value, name);
}

function QQ_Voice2Text(event: JQuery.TriggeredEvent) {
  // 停止事件传播
  event.stopPropagation();

  if (!event.currentTarget) {
    return;
  }

  const $avatar = $(event.currentTarget);
  const $tobutton = $avatar.find(".totext");
  if ($tobutton.length === 0) {
    console.log(`获取转文字按钮失败`);
  }
  const $text = $avatar.next();
  if ($text.css("display") == "block") {
    // $tobutton.css("visibility", "visible");
    $text.hide();
  }
  else {
    // $tobutton.css("visibility", "hidden");
    $text.show();
    $tobutton.css("margin-left", "auto");
  }
}

/**
 * 发送消息
 * @param event 事件对象
 * @param SendValue 发送的值
 * @param SendName 发送的名称
 * @returns
 */
async function QQ_SendMsg(
  event: JQuery.TriggeredEvent,
  SendValue?: string,
  SendName?: string
) {
  const Request = `<Request:{{user}}本次发了消息的角色都要回复{{user}}的消息,只输出对方新消息即可,禁止重复输出前面的聊天记录>`;

  if (gening) {
    triggerSlash("/echo 生成中,请勿重复发送");
    return;
  }

  let name: string;
  let value: string;
  if (!SendValue) {
    const $container = $(event.target as HTMLElement).closest(
      '.QQ_chat_page'
    );
    const input = $container.find(".userInput");
    const msgcontent = $container.find(".msgcontent");
    let content = input.val()?.toString() ?? "";
    content = QQ_MySendSpecial(content);

    if (content) {
      const SpecialHtml = QQ_Chat_SpecialMsg(content, "{{user}}", false, true);
      console.log(`特殊格式处理后的内容:\n${SpecialHtml}`);
      const html = _.template(chat_user_message)({ content: SpecialHtml });
      name = $container.attr("data-name") || "未知用户";
      console.log(`发送文本:${content} 对象:${name}`);
      msgcontent.append(html);
      msgcontent.scrollTop(msgcontent[0].scrollHeight);
      input.val("");
    } else {
      name = $container.attr("data-name") || "未知用户";
      console.warn("发送内容为空");
    }

    console.log(`缓存消息$:${QQ_CacheSendMsg}`);

    if (QQ_Groups.includes(name)) {
      if (QQ_CacheSendMsg) {
        value = `${QQ_CacheSendMsg}`;
        if (content) {
          value += `\n<本次响应必须遵守线上模式格式>在群聊${name}中发送:${content}`;
        }
        value += `\n${Request}`;
      } else {
        value = `<本次响应必须遵守线上模式格式>在群聊${name}中发送:${content}`;
      }
    } else {
      if (QQ_CacheSendMsg) {
        value = `${QQ_CacheSendMsg}`;
        if (content) {
          value += `\n<本次响应必须遵守线上模式格式>给${name}发消息:${content}`;
        }
        value += `\n${Request}`;
      } else {
        value = `<本次响应必须遵守线上模式格式>给${name}发消息:${content}`;
      }
    }

    if (!value && !QQ_CacheSendMsg) {
      QQ_Error("发送消息不能为空");
      return;
    }

    QQ_CacheSendMsg = "";

    if (value) {
      const namevalue = QQ_GetValueName(value);
      if (namevalue) {
        for (const match of namevalue) {
          let localname = match.name;
          let localmsg = match.value;
          if (QQ_Groups.includes(localname)) {
            //type = '群聊';
            QQ_msgjson.群聊[localname] = QQ_msgjson.群聊[localname] || {};
            QQ_msgjson.群聊[localname].msgs =
              QQ_msgjson.群聊[localname].msgs || [];
            QQ_msgjson.群聊[localname].msgs.push(`{{user}}--${localmsg}`);

            //console.log(`加入自己发的群聊消息: {{user}}--${localmsg}`);
            User_LastMsgMap.群聊[localname] = `{{user}}--${localmsg}`;
          } else {
            const key = `{{user}}和${localname}的聊天`;
            QQ_msgjson.私聊[key] = QQ_msgjson.私聊[key] || [];
            QQ_msgjson.私聊[key].push(`{{user}}--${localmsg}`);

            //console.log(`加入自己发的私聊消息: {{user}}--${localmsg}`);
            User_LastMsgMap.私聊[localname] = `{{user}}--${localmsg}`;
          }
        }
      }
    } else {
      QQ_Error("发送消息不能为空");
      return;
    }
  } else {
    value = SendValue;
    name = SendName || "未知用户";
    if (QQ_Groups.includes(name)) {
      value = `在群聊${name}中发送:${SendValue}`;
      User_LastMsgMap.群聊[name] = value;
    } else {
      value = `给${name}发消息:${SendValue}`;
      User_LastMsgMap.私聊[name] = value;
    }
  }

  gening = true;
  let result;

  try {
    QQ_CacheSendMsg = "";
    result = await QQ_Gen(value);
  } finally {
    gening = false;
    console.log(`生成结束`);
    QQ_Save_Msg();
  }

  if (!result) {
    triggerSlash("/echo 空回复了");
    return;
  }

  const matches = [...result.matchAll(/MiPhone_start([\s\S]+?)MiPhone_end/g)];
  if (matches.length == 0) {
    triggerSlash('/echo 结果不带格式,直接输出到新楼层');
    triggerSlash(`/sendas name={{char}} ${result}`);
    return;
  }
  else if (matches.length > 1) {
    triggerSlash('/echo 出现多个格式,直接输出到新楼层');
    triggerSlash(`/sendas name={{char}} ${result}`);
    return;
  }
  else {
    result = matches[0][1];
  }

  // let type = "私聊";
  // if (QQ_Groups.includes(name)) {
  //   type = "群聊";
  //   QQ_msgjson.群聊[name] = QQ_msgjson.群聊[name] || {};
  //   QQ_msgjson.群聊[name].msgs = QQ_msgjson.群聊[name].msgs || [];
  //   QQ_msgjson.群聊[name].msgs.push(`{{user}}--${value}`);
  // } else {
  //   QQ_msgjson.私聊[name] = QQ_msgjson.私聊[name] || [];
  //   QQ_msgjson.私聊[name].push(`{{user}}--${value}`);
  // }

  let ok = false;
  const msg = result.match(/msg_start([\s\S]+?)msg_end/);
  if (msg) {
    ok = true;
    let json = JsonYamlParse(msg[1]);
    if (!json) {
      QQ_Error("AI输出的格式不正确，双击自己头像重Roll");
      return;
    }
    // triggerSlash(`/echo 生成结果${msg[1]}`);
    json = QQ_Msg_DeletOld(json);
    QQ_Msg_Parse(YAML.stringify(json));
  }

  const momentes = result.matchAll(/moment_start([\s\S]+?)moment_end/g);
  if (momentes) {
    ok = true;
    for (const moment of momentes) {
      QQ_Moment_Parse(moment[1]);
    }
  }

  if (!ok) {
    triggerSlash("/echo 回复不为空但不存在手机格式,输出到新楼层");
    triggerSlash(
      `/sendas name={{char}} ${result
        .replace("MiPhone_start", "")
        .replace("MiPhone_end", "")}`
    );
    return;
  }

  QQ_UpdateNewTips();

  QQ_Save_Msg();
}

function QQ_UpdateNewTips() {
  // 刷新左上角未读信息数字
  let ids = $('.QQ_chat_page').map(function () {
    return this.id; // 直接返回元素的 ID
  }).get().filter(Boolean); // 过滤掉空 ID
  for (const id of ids) {
    if ($(id).css("display") == "none") {
      continue;
    }
    const name = id.replace("QQ_chat_", "");
    let TipsCount = QQ_GetChatShowTipsCount(name);
    console.log(`获取到${name}的左上角数字为:${TipsCount}`);
    const $Tips = $(`#QQ_chat_${name}`).find(`.new_tips`);
    $Tips.text(TipsCount);
    if (TipsCount > 0) {
      $Tips.css("display", "flex");
      console.log(`显示tips`);
    }
    else {
      $Tips.hide();
      console.log(`隐藏tips`);
    }
  }
}

/**
 * 返回首页
 */
function QQ_GoHome() {
  // 查找当前显示的聊天页面
  const $currentChatPage = $(`.QQ_chat_page:visible`);
  const $homePage = $("#QQ_home_page");

  if ($currentChatPage.length > 0) {
    // 添加退出动画 - 向右退出，与进入时的方向相反
    $currentChatPage.addClass("page-transition-leave");

    // 动画完成后执行操作
    setTimeout(() => {
      // 隐藏所有聊天页
      QQ_HideAllChat();

      // 移除动画class
      $currentChatPage.removeClass("page-transition-leave");

      // 显示主页并添加从左向右进入的动画
      $homePage.addClass("page-transition-return").show();

      // 动画完成后移除class
      setTimeout(() => {
        $homePage.removeClass("page-transition-return");

        // 检查联系人状态
        checkContactStatus();
      }, 280);

      console.log("返回QQ主页");
    }, 280);
  } else {
    // 如果没有聊天页显示，直接显示主页
    QQ_HideAllChat();
    $homePage.show();
    console.log("直接显示QQ主页");

    // 检查联系人状态
    checkContactStatus();
  }
}

/**
 * 错误提示
 * @param content 提示内容
 * @param change 是否更换浏览器
 */
function QQ_Error(content: string, change?: boolean) {
  triggerSlash(`/echo severity=error ${content}`);
  if (change) {
    triggerSlash(`/echo 请更换浏览器重试`);
  }
}

/**
 * 初始化
 */
async function init() {
  // 确保QQ_momentjson已初始化
  QQ_momentjson = {};

  try {
    worldbook = (await GetWorldBookName()) as string;
    if (!worldbook) {
      QQ_Error(`获取世界书失败!!!!`);
    }

    entries = await getLorebookEntries(worldbook);
    if (!entries) {
      QQ_Error(`获取世界书条目失败!!!!`);
    }
  } catch (e) {
    QQ_Error(`出现异常:\n${e}`);
  }
  Variables = await getVariables();
  NpcCssValue = Variables.NpcCssValue ?? "";
  console.log(`首次读取到的NpcCss:\n${NpcCssValue}`);
  $("<style>").attr("data-name", "AutoNpc").text(NpcCssValue).appendTo("head");


  DelPadding(); // 移除头像和边距
  await GetSettings();
  await LoadRandomHead();
  await LoadEmoji();
  await LoadChars();
  await MiPhone_Merge();

  // 检查是否拥有联系方式
  await checkContactStatus();

  head_init();

  // 为聊天元素绑定点击事件
  $(document).on("click", "#QQ_message_nav", () => QQ_page("message"));
  $(document).on("click", "#QQ_people_nav", () => QQ_page("people"));
  $(document).on("click", "#QQ_moment_nav", () => QQ_page("moment"));
  $(document).on("click", ".QQ-close-btn", () => QQ_GoHome());
  $(document).on("click", ".QQ_home_usermsg", (e: JQuery.TriggeredEvent) =>
    QQ_ChangeChatPage(e)
  );
  $(document).on("click", "#QQ_chat_page_setting", (e: JQuery.TriggeredEvent) =>
    QQ_SetChatPageSetting(e)
  );
  $(document).on("click", ".close-setting-btn", () => closeSettingPopup());
  $(document).on("click", "#cancel-setting-btn", () => closeSettingPopup());
  $(document).on("click", "#save-setting-btn", () => saveSettingAndClose());
  $(document).on("click", "#QQ_chat_send-btn", (event: JQuery.TriggeredEvent) =>
    QQ_SendMsg(event)
  );
  $(document).on("dblclick", ".Chat_MyHead", (e: JQuery.TriggeredEvent) =>
    QQ_Roll(e)
  );
  $(document).on("click", ".QQ_chat_voice", (e: JQuery.TriggeredEvent) =>
    QQ_Voice2Text(e)
  );
  $(document).on("click", ".music-container", (e: JQuery.TriggeredEvent) =>
    QQ_MusicPlay(e)
  );
  $(document).on("click", ".popup-overlay", function (e) {
    if (e.target === this) {
      closeSettingPopup();
    }
  });
  $(document).on("click", ".top", function () {
    //SetCssVariable("伊凡德", "MsgColor", "#FFFFFF");
  });
  $(document).on("click", ".app-svg-div[data-app='QQ']", () => App_Load("QQ"));
  $(document).on("click", ".app-svg-div[data-app='twitter']", () => App_Load("twitter"));
  // 添加输入框回车事件监听
  $(document).on("keydown", ".userInput", function (e) {
    QQ_EnterPress(e, this);
  });

  const message = await ST.GetCurrentMessages();
  let match = message.match(/msg_start([\s\S]+?)msg_end/);
  if (match) {
    QQ_Msg_Parse(match[1].trim());
    if (!match[1].match(/\S/)) {
      // 没有有效内容才保存
      await QQ_Save_Msg();
    }
  }

  // 解析所有动态内容
  const momentMatches = [...message.matchAll(/moment_start([\s\S]+?)moment_end/g)];
  if (momentMatches && momentMatches.length > 0) {
    console.log(`找到${momentMatches.length}个动态内容，开始处理`);

    // 清空space_contents以防止重复添加
    $("#space_contents").empty();

    // 先检查每个moment内容的格式是否正确
    for (const m of momentMatches) {
      if (m && m[1]) {
        const content = m[1].trim();
        console.log(`解析动态内容: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`);

        // 验证格式
        const firstLine = content.split('\n')[0];
        const parts = firstLine.match(/(.+?)--(.+?)--(.+?)--(.+?)--(.+)/);

        if (parts && parts.length >= 6) {
          if (parts[2] && parts[2].trim() !== "") {
            console.log(`动态格式正确: ${parts[1]}--${parts[2].substring(0, 20)}${parts[2].length > 20 ? '...' : ''}`);
            QQ_Moment_Parse(content);
          } else {
            console.log(`动态内容部分为空，不解析: ${firstLine}`);
          }
        } else {
          console.log(`动态格式不正确，不解析: ${firstLine}`);
        }
      }
    }
  } else {
    console.log("未找到动态内容");
  }

  // 绑定动态评论事件
  bindMomentCommentEvents();

  console.log(`群聊列表:${QQ_Groups.join(",")}`);

  // 初始化表情菜单
  initEmojiMenu();
}

/**
 * 检查是否拥有联系方式并更新UI
 */
async function checkContactStatus() {
  // 读取变量
  const variables = await getVariables();

  // 检查是否有变量.络络.拥有联系方式，如果没有则默认为1（显示联系人）
  const hasContact = _.get(variables, '变量.络络.拥有联系方式', 1);

  console.log(`拥有联系方式: ${hasContact}`);

  if (parseInt(hasContact) === 0) {
    // 隐藏所有联系人
    $("#QQ_home_chars").hide();

    // 显示"暂无联系人"的提示
    if ($("#no_contacts_message").length === 0) {
      $("<div id='no_contacts_message' style='text-align: center; padding: 20px; color: #888; font-size: 14px;'>暂无联系人</div>").insertAfter("#QQ_home_chars");
    } else {
      $("#no_contacts_message").show();
    }
  } else {
    // 显示联系人列表
    $("#QQ_home_chars").show();

    // 隐藏"暂无联系人"的提示
    $("#no_contacts_message").hide();
  }
}

// 添加事件监听，当用户可能更改了变量时重新检查
$(document).on("message_sent message_received", async function () {
  await checkContactStatus();
});

//space_init();
console.log(`4.5`);
init();

async function QQ_MusicPlay(event: JQuery.TriggeredEvent) {
  event.stopPropagation();
  if (!event.currentTarget) return;

  const $element = $(event.currentTarget);
  const musicname = $element.find(".music-name")?.text().trim();
  const singer = $element.find(".music-author")?.text().trim();

  if (!musicname) {
    QQ_Error("获取歌曲信息失败");
    return;
  }

  const $playbutton = $element.find(".icon-music-play");
  const $stopbutton = $element.find(".icon-music-stop");

  // 立即切换按钮状态
  if (!$playbutton.is(":hidden")) {
    // 🔴 先改变界面状态
    $playbutton.hide();
    $stopbutton.show();
    $element.addClass("loading"); // 添加加载动画
    QQ_Music.lastelement = $element;

    try {
      // 异步获取音源
      let source = await WY_MusicGetUrl(musicname, singer);
      if (!source?.url) {
        console.log(`网易云获取失败,开始在QQ音乐中搜索`);
        source = await QQ_MusicGetUrl(musicname);
        if (!source || !source.url) {
          throw new Error("无可用音源");
        }
      }

      // 设置新音源
      QQ_Music.audio.src = source.url;
      if (source.cover) {
        $element.find(".music-img").css("background-image", `url('${source.cover}')`)
        $element.find(".music-img").show();
      }

      // 自动播放
      await QQ_Music.audio.play();

      // 更新其他元素状态
      if (QQ_Music.lastelement && !QQ_Music.lastelement.is($element)) {
        QQ_Music.lastelement.find(".icon-music-stop").hide();
        QQ_Music.lastelement.find(".icon-music-play").show();
      }
    } catch (error) {
      console.error("播放失败:", error);
      QQ_Error("播放失败");
      // 🔴 失败时回滚按钮状态
      $playbutton.show();
      $stopbutton.hide();
    } finally {
      $element.removeClass("loading");
    }
  } else {
    // 暂停逻辑保持不变
    QQ_Music.audio.pause();
    $playbutton.show();
    $stopbutton.hide();
  }
}

async function QQ_MusicGetUrl(name: string) {
  try {
    // 获取歌曲列表

    name = name.replace(/\s/g, "");

    let cover = "";

    const result = await Http_Get(`https://api.vkeys.cn/v2/music/tencent?word=${name}`);
    if (!result?.data?.length) {
      QQ_Error("搜索歌曲失败");
      return;
    }

    // 提取所有id
    let ids: string[] = [];
    for (const data of result.data) {
      if (!cover && data.cover) {
        cover = data.cover;
      }
      if (data.id) {
        ids.push(data.id);
      }
      if (data.grp) {
        for (const grp of data.grp) {
          if (grp.id) {
            ids.push(grp.id);
          }
        }
      }
    }
    console.log(`id数量:${ids.length}`);
    // 遍历音质组检测可用音源
    for (const id of ids) {
      try {
        // 获取具体音源URL
        console.log(`准备检测音源 ID:${id}`);
        const r = await Http_Get(`https://api.vkeys.cn/v2/music/tencent?id=${id}`);
        if (!r?.data?.url) continue;

        // 异步检测音源可用性
        const isAvailable = await checkAudioAvailability(r.data.url);
        if (isAvailable) {
          console.log(`找到可用音源: ${r.data.url}`);
          return {
            url: r.data.url,
            cover: cover,
          };
        }
      } catch (e) {
        console.warn(`音源检测失败: ${id}`, e);
      }
    }

    QQ_Error("没有找到可用音源");
  } catch (e) {
    QQ_Error("歌曲搜索异常");
    console.error("获取音源失败:", e);
  }
}

async function WY_MusicGetUrl(name: string, singer?: string) {
  let url = `https://api.vkeys.cn/v2/music/netease?word=${name}`;
  if (singer) {
    url += `-${singer}`;
  }
  let result = await Http_Get(url);
  if (!result) return;

  let cover = "";
  let ids = [];
  for (const data of result.data) {
    if (!cover && data.cover) {
      cover = data.cover;
    }
    if (data.id) {
      ids.push(data.id);
    }
  }

  for (const id of ids) {
    try {
      // 获取具体音源URL
      console.log(`准备检测音源 ID:${id}`);
      const r = await Http_Get(`https://api.vkeys.cn/v2/music/netease?id=${id}`);
      if (!r?.data?.url) continue;

      // 异步检测音源可用性
      const isAvailable = await checkAudioAvailability(r.data.url);
      if (isAvailable) {
        console.log(`找到可用音源: ${r.data.url}`);
        return {
          url: r.data.url,
          cover: cover,
        };
      }
    } catch (e) {
    }
  }
}

/** 音频可用性检测函数 */
async function checkAudioAvailability(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    // 创建测试用音频对象
    const tester = new Audio();
    let timer: NodeJS.Timeout;

    // 成功加载元数据
    const onLoaded = () => {
      cleanup();
      resolve(true);
    };

    // 发生错误或超时
    const onError = () => {
      cleanup();
      resolve(false);
    };

    // 清理事件监听
    const cleanup = () => {
      tester.removeEventListener('loadedmetadata', onLoaded);
      tester.removeEventListener('error', onError);
      clearTimeout(timer);
      tester.src = ''; // 释放资源
    };

    // 设置检测参数
    tester.preload = 'metadata';
    tester.src = url;
    timer = setTimeout(onError, 3000); // 3秒超时

    // 绑定事件监听
    tester.addEventListener('loadedmetadata', onLoaded);
    tester.addEventListener('error', onError);
  });
}

function Http_Get(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    $.ajax({
      url: url,
      method: 'GET',
      timeout: 10000,
      success: function (data, status) {
        resolve(data); // 成功时返回数据
      },
      error: function (xhr, status, error) {
        if (status === 'timeout') {
          console.error('请求超时，请检查网络或重试');
        } else {
          console.error('请求失败，错误信息：', error);
        }
        resolve(null);
        //reject(error); // 失败时抛出错误
      }
    });
  });
}

function JsonYamlParse(content: string) {
  content = content.replace(/\{\{user\}\}/g, '<user>');
  try {
    let json = JSON.parse(content);
    return json;
  } catch {
    console.log(`json解析失败`);
  }

  try {
    let yaml = YAML.parse(content);
    return yaml;
  } catch {
    console.log(`yaml解析失败`);
  }

  try {
    content = fixYamlSingleQuotes(content);
    console.log(`修复后的yaml文本:\n${content}`);
    if (!content) {
      return null;
    }
    let yaml = YAML.parse(content);
    return yaml;
  } catch {
    console.log(`yaml修复失败`);
    return null;
  }
}

function fixYamlSingleQuotes(yamlText: string) {
  try {
    return yamlText.replace(
      /(- ')(.*?[^\\])(')(?=\s*#|$)/gm,
      (match, prefix, content, suffix) => {
        // 使用三步处理法保证已有转义不变
        const escaped = content
          .replace(/''/g, '\uE000')  // 步骤1：用临时Unicode占位符保存已有双引号
          .replace(/'/g, "''")        // 步骤2：转义所有剩余单引号
          .replace(/\uE000/g, "''"); // 步骤3：恢复原有双引号

        return `${prefix}${escaped}${suffix}`;
      }
    );
  } catch (e) {
    QQ_Error(`${e}`);
    return "";
  }
}

async function MiPhone_Merge() {
  let messages = await ST.GetCurrentMessages();
  const matches = messages.matchAll(/MiPhone_start([\s\S]+?)MiPhone_end/g);
  if (!matches) {
    console.log("未找到MiPhone内容");
    return;
  }
  const matchesArray = [...matches];
  const length = matchesArray.length;
  console.log(`匹配到MiPhone数量:${length}`);
  if (length <= 1) {
    console.log("MiPhone数量不足，不需要合并");
    return;
  }

  // 用于收集所有moment内容
  let allMoments: string[] = [];

  for (let i = 0; i < matchesArray.length; i++) {
    const value = matchesArray[i][0];
    console.log(`处理MiPhone块 #${i + 1}`);

    // 处理消息部分
    const msg = value.match(/msg_start([\s\S]+?)msg_end/);
    if (msg) {
      let json;
      try {
        json = JsonYamlParse(msg[1]);
        if (json) {
          json = QQ_Msg_DeletOld(json);
          QQ_Msg_Parse(YAML.stringify(json));
        }
      } catch (error) {
        console.error("解析消息发生错误:", error);
      }
    }

    // 收集所有moment内容
    const momentMatches = [...value.matchAll(/moment_start([\s\S]+?)moment_end/g)];
    if (momentMatches && momentMatches.length > 0) {
      console.log(`在MiPhone块 #${i + 1}中找到${momentMatches.length}个动态内容`);
      for (const momentMatch of momentMatches) {
        if (momentMatch && momentMatch[1]) {
          const momentContent = momentMatch[1].trim();
          if (momentContent) {
            // 检查内容格式是否正确
            const firstLine = momentContent.split('\n')[0];
            const parts = firstLine.match(/(.+?)--(.+?)--(.+?)--(.+?)--(.+)/);

            if (parts && parts[2] && parts[2].trim() !== "") {
              console.log(`收集动态: ${parts[1]}--${parts[2].substring(0, 20)}${parts[2].length > 20 ? '...' : ''}`);
              allMoments.push(momentContent);
            } else {
              console.log(`跳过格式不正确的动态内容: ${firstLine}`);
            }
          }
        }
      }
    }

    // 处理当前迭代的MiPhone块
    if (i != matchesArray.length - 1) {
      messages = messages.replace(value, "");
    } else {
      // 为最后一个MiPhone块，整合所有内容
      if (msg) {
        // 构建新的MiPhone内容，包含消息和所有收集到的moment
        let newContent = `msg_start\n${YAML.stringify(QQ_msgjson)}\nmsg_end`;

        // 添加所有收集的moment内容
        for (const moment of allMoments) {
          newContent += `\nmoment_start\n${moment}\nmoment_end`;
        }

        const newValue = `MiPhone_start\n${newContent}\nMiPhone_end`;
        messages = messages.replace(value, newValue);
      } else {
        // 如果没有消息部分，则直接构建新的MiPhone块
        let newContent = `msg_start\n${YAML.stringify(QQ_msgjson)}\nmsg_end`;

        // 添加所有收集的moment内容
        for (const moment of allMoments) {
          newContent += `\nmoment_start\n${moment}\nmoment_end`;
        }

        const newValue = `MiPhone_start\n${newContent}\nMiPhone_end`;
        messages = messages.replace(value, newValue);
      }
    }
  }

  const CurrentMessageId = await getCurrentMessageId();
  setChatMessage({ message: messages }, CurrentMessageId);
  console.log(`成功合并MiPhone块，整合了${allMoments.length}个动态内容`);
}


/**
 * 初始化动态空间内容
 */
function space_init() {
  $("#space_contents").prepend(space_contents);
}

async function GetWorldBookName() {
  const localbook = await getCurrentCharPrimaryLorebook();
  if (localbook) {
    const localentrys = await getLorebookEntries(localbook);
    const targetEntry = localentrys.find((entry) =>
      ["手机-界面基本设置", "手机界面基本设置"].includes(entry.comment)
    );
    if (targetEntry) {
      console.log(`使用角色卡绑定的世界书`);
      return localbook;
    }
  }

  const globalbook = (await getLorebookSettings()).selected_global_lorebooks;
  if (globalbook) {
    for (const book of globalbook) {
      const localentrys = await getLorebookEntries(book);
      const targetEntry = localentrys.find((entry) =>
        ["手机-界面基本设置", "手机界面基本设置"].includes(entry.comment)
      );
      if (targetEntry) {
        console.log(`使用全局世界书:${book}`);
        return book;
      }
    }
  }
  console.log(`没有匹配的世界书`);
  return null;
}

async function DelPadding() {
  const message_id = await getCurrentMessageId();
  console.log(`开始移除头像和边距:${message_id}`);
  $(`div.mes[mesid="${message_id}"]`, window.parent.document)
    .find(`div.mes_text`)
    .css("padding-right", "0");

  $(`div.mes[mesid="${message_id}"]`, window.parent.document)
    .find(`div.avatar`)
    .css("display", "none");

  $(`div.mes[mesid="${message_id}"]`, window.parent.document)
    .find(`div.mesAvatarWrapper`)
    .css("display", "none");
}
/**
 * 获取设置
 */
async function GetSettings() {
  let content = "";
  for (let entry of entries) {
    if (
      entry.comment == "手机-界面基本设置" ||
      entry.comment == "手机界面基本设置"
    ) {
      content = entry.content;
      break;
    }
  }
  if (!content) {
    return;
  }
  console.log(`获取到设置文本:${content}`);

  Phone_Settings.loadText(content);
  console.log(`测试获取ini:${Phone_Settings.readValue("下面是基本设置", "聊天壁纸")}`)

  let regex = new RegExp(`内框颜色=(.+)`);
  let match = content.match(regex);
  if (match) {
    let value = match[1];
    if (value[0] != "#") {
      value += "#";
    }
    console.log(`设置气泡颜色为 ${value}`);
    $("<style>")
      .text(`.card { background-color: ${value} !important; }`)
      .appendTo("head");
    $("<style>")
      .text(`.top { background-color: ${value} !important; }`)
      .appendTo("head");
  }

  regex = new RegExp(`外框颜色=(.+)`);
  match = content.match(regex);
  if (match) {
    let value = match[1];
    if (value[0] != "#") {
      value += "#";
    }
    console.log(`设置气泡颜色为 ${value}`);
    $("<style>")
      .text(`.card { border: 2px solid ${value} !important; }`)
      .appendTo("head");
  }

  regex = new RegExp(`侧边按钮=(.+)`);
  match = content.match(regex);
  if (match) {
    let value = match[1];
    if (value[0] != "#") {
      value += "#";
    }
    console.log(`设置气泡颜色为 ${value}`);
    $("<style>")
      .text(`.btn1 { background-color: ${value} !important; }`)
      .appendTo("head");
    $("<style>")
      .text(`.btn2 { background-color: ${value} !important; }`)
      .appendTo("head");
    $("<style>")
      .text(`.btn3 { background-color: ${value} !important; }`)
      .appendTo("head");
  }

  regex = new RegExp(/^发送模式=(\d+)/m);
  match = content.match(regex);
  if (match) {
    if (match[1] == "2") {
      newgen = false;
      console.log("设置发送模式为非流式");
    } else {
      newgen = true;
      console.log("设置发送模式为流式");
    }
  } else {
    console.log("未找到发送模式设置，使用默认流式发送");
  }

  regex = new RegExp(`聊天壁纸=(http.+)`);
  match = content.match(regex);
  if (match) {
    //console.log(`设置聊天壁纸:${match[1]}`);
    $('<style>').text(`.QQ_chat_page {
      background-image: url("${match[1]}");
    }`).appendTo('head');
  }

  regex = new RegExp(`气泡颜色=(.+)`);
  match = content.match(regex);
  if (match) {
    let value = match[1];
    if (value[0] != "#") {
      value += "#";
    }
    //console.log(`设置气泡颜色为 ${value}`);
    $('<style>').text(`.QQ_chat_msgdiv { background-color: ${value} !important; }`).appendTo('head');
  }
}

/**
 * 根据角色名获取聊天设定
 *
 * @param name 角色名
 * @returns 聊天设定
 */
function GetChatCharSettingByName(name: string): ChatCharSetting | undefined {
  let char_setting = "";
  for (let entry of entries) {
    if (entry.comment == "配置-聊天-角色个人设定") {
      char_setting = entry.content.trim();
    }
  }
  if (!char_setting) {
    return;
  }
  const char_setting_json = JSON.parse(char_setting);
  const setting = char_setting_json.find(
    (item: { name: string }) => item.name === name
  );

  if (!setting) {
    return;
  }
  console.log(`获取到角色设定:${YAML.stringify(setting)}`);
  return setting;
}

function assertIsError(error: unknown): asserts error is Error {
  if (!(error instanceof Error)) {
    throw new TypeError();
  }
}

function random(min: number, max: number) {
  return Math.floor(Math.random() * (max - min) + min);
}

function head_init() {
  let girl = `EJeUD/Image_1737026320652.jpg|Y8pt1/Image_1737026296736.jpg|QWWc6/Image_1737026308451.jpg|Z8LIW/Image_1737026306601.jpg|W8lhW/Image_1737026313246.jpg|0rJtX/Image_1737026292787.jpg|yVxsN/Image_1737026293840.jpg|vaBCL/Image_1737026286979.jpg|pZ6hQ/Image_1737026285632.jpg|11AH2/Image_1737026284351.jpg|eXKUw/Image_1737026281715.jpg|o31F4/Image_1737026277201.jpg|8E2uj/Image_1737026279242.jpg|GLmIl/Image_1737026275069.jpg|zWZT5/Image_1737026271769.jpg|7Zrij/Image_1737026269532.jpg|AqYsZ/Image_1737026266131.jpg|w4lFq/2406563368.jpeg|MQNua/2403629154.jpeg|3YZhe/2405854911.jpeg|5QKhj/2312445144.jpeg|k6JT6/2408434848.jpeg|j6Bf6/2386328773.jpeg|a8LHY/2386327598.jpeg|r08C6/2386327604.jpeg|DgECK/2331678725.jpeg|LJrC7/2371251634.jpeg|q1LF3/2329660869.gif|X84sW/2328035526.jpeg|2eDfQ/2326662447.jpeg|ggetw/2326683821.jpeg|J21ig/2323432137.gif`;
  let girls = girl.split("|");
  let result = "";
  for (let i = 0; i < girls.length; i++) {
    if (girls[i]) {
      random_head_list.push(girls[i]);
      result += `\nhttp://sharkpan.xyz/f/${girls[i]}`;
    }
  }
  console.log(`随机头像列表:\n${result}`);
}

// 增加音频状态监听
QQ_Music.audio.addEventListener("ended", () => {
  if (QQ_Music.lastelement) {
    QQ_Music.lastelement.find(".icon-music-stop").hide();
    QQ_Music.lastelement.find(".icon-music-play").show();
  }
});

QQ_Music.audio.addEventListener("error", () => {
  if (QQ_Music.lastelement) {
    QQ_Music.lastelement.find(".icon-music-stop").hide();
    QQ_Music.lastelement.find(".icon-music-play").show();
  }
  QQ_Error("播放出错，请尝试重新播放");
});

// 增加音频中断监听
QQ_Music.audio.addEventListener('pause', () => {
  if (QQ_Music.lastelement) {
    QQ_Music.lastelement.find(".icon-music-stop").hide();
    QQ_Music.lastelement.find(".icon-music-play").show();
  }
});

async function LoadRandomHead() {
  let content = "";
  for (let entry of entries) {
    if (entry.comment == "手机-随机头像") {
      content = entry.content;
    }
  }
  if (!content) {
    return;
  }
  const matches = content.matchAll(/^http.+$/mg);
  for (const match of matches) {
    const obj = {
      url: match[0],
      count: [...NpcCssValue.matchAll(new RegExp(match[0], "g"))].length
    }
    QQ_RandomHead.push(obj);
  }
}

/**
 * 获取表情包
 */
async function LoadEmoji() {
  let content = "";
  let phonebook = "";
  let phoneuid = -1;
  for (let entry of entries) {
    if (
      entry.comment == "手机-表情包存放" ||
      entry.comment == "表情包存放世界书"
    ) {
      content = entry.content;
    } else if (entry.comment == "手机-格式" || entry.comment == "手机格式") {
      phonebook = entry.content;
      phoneuid = entry.uid;
    }
  }

  // 首先加载世界书中的表情包
  if (content) {
    const regex = new RegExp("(.+?)--(http.+)", "g");
    const matches = [...content.matchAll(regex)];
    if (matches) {
      console.log(`世界书表情包数量:${matches.length}`);
      for (const match of matches) {
        QQ_emoji.set(match[1], match[2]);
      }
    }
  } else {
    console.log(`获取表情包世界书失败`);
  }

  // 添加我们的固定表情包到Map中
  emojiList.forEach(emoji => {
    QQ_emoji.set(emoji.name, emoji.url);
  });

  console.log(`加载表情包完成，总数量: ${QQ_emoji.size}`);

  // 更新表情包列表到世界书
  if (phonebook && phoneuid) {
    const keysArray = JSON.stringify(Array.from(QQ_emoji.keys()));
    const m = phonebook.match(/<表情包列表>([\s\S]*?)<\/表情包列表>/);
    if (m) {
      phonebook = phonebook.replace(
        m[0],
        `<表情包列表>\n${keysArray}\n<\/表情包列表>`
      );
      await setLorebookEntries(worldbook, [
        { uid: phoneuid, content: phonebook },
      ]);
    }
  }
}

/**
 * 聊天-加载角色列表
 *
 */
async function LoadChars() {
  let content;
  for (let entry of entries) {
    if (entry.comment == "手机-角色" || entry.comment == "手机界面-角色") {
      content = entry.content;
      break;
    }
  }
  if (!content) {
    return;
  }

  QQ_CharSettings.loadText(content);
  console.log(`GetAllText:\n${QQ_CharSettings.getAllText()}`);
  for (let section of QQ_CharSettings.getAllSections()) {
    const hasGetCharAvatar = typeof getCharAvatarPath === "function"; // 核心检查逻辑
    const type = QQ_CharSettings.readValue(section, "类型");
    if (section == "char") {
      section = getFilenameWithoutExtension(charAvatarPath);
    }
    let headurl = QQ_CharSettings.readValue(section, "头像");
    if (!headurl) {
      if (hasGetCharAvatar) {
        headurl = await getCharAvatarPath(section);
      } else {
        QQ_Error(`自动获取头像要求前端助手版本在2.4.4及以上版本`);
        continue;
      }
    }
    else {
      const match = headurl.match(/[<{]+(.+?)[>}]/);
      if (match) {
        if (hasGetCharAvatar) {
          headurl = await getCharAvatarPath(match[1]);
        } else {
          QQ_Error(`自动获取头像要求前端助手版本在2.4.4及以上版本`);
          continue;
        }
      }
    }
    if (!type.match(/npc/i) && type != "路人") {
      AddNewChar(section, headurl);
      if (type == "群聊") {
        if (!QQ_Groups.includes(section)) {
          QQ_Groups.push(section);
        }
        QQ_msgjson.群聊[section] = {};
        QQ_msgjson.群聊[section].msgs = [];
        QQ_msgjson.群聊[section].menbers = QQ_CharSettings
          .readValue(section, "成员")
          .split(/[,，]/g);
      }
      else {
        QQ_msgjson.私聊[`{{user}}和${section}的聊天`] = [];
      }
    }

    let CssValue = new Map();
    let divkey = `.QQ_chat_msgdiv[data-name='${section}']`;
    let MsgColor = QQ_CharSettings.readValue(section, "气泡颜色");
    if (MsgColor) {
      MsgColor = MsgColor[0] == "#" ? MsgColor : `#${MsgColor}`;
      CssValue.set(divkey, `--MsgColor: ${MsgColor};
        background-color: var(--MsgColor) !important; `);
      console.log(`设置了角色 ${section} 的气泡颜色:${MsgColor}`);
    }

    let TextColor = QQ_CharSettings.readValue(section, "字体颜色");
    if (TextColor) {
      TextColor = TextColor[0] == "#" ? TextColor : `#${TextColor}`;
      if (CssValue.has(divkey)) {
        CssValue.set(divkey, CssValue.get(divkey) + `--TextColor: ${TextColor};`);
      }
      CssValue.set(`.QQ_chat_msgdiv[data-name='${section}'] span`, `color:var(--TextColor) !important;`)
      console.log(`设置了角色 ${section} 的字体颜色:${TextColor}`);
    }

    let BackGroundImg = QQ_CharSettings.readValue(section, "聊天壁纸");
    if (BackGroundImg) {
      CssValue.set(`.QQ_chat_page[data-name='${section}']`, `--BackGroundImg: url('${BackGroundImg}');
        background-image:var(--BackGroundImg) !important;`);
      console.log(`设置了角色 ${section} 的聊天壁纸:${BackGroundImg}`);
    }

    if (CssValue) {
      let value = "";
      for (const key of CssValue.keys()) {
        value += `\n${key}{${CssValue.get(key)}}`;
      }
      if (value) {
        $(`<style>`).attr("data-name", section).text(value).appendTo('head');
        //console.log(`设置css:\n${value}`);
      }
    }

    //console.log(`获取到的样式表:\n${$(`style[data-name='${section}']`).text()}`);
  }
}

function SetCssVariable(name: string, variable: string, value: string) {
  let cssvalue = $(`style[data-name='${name}']`).text();
  if (!cssvalue) {
    return;
  }

  const match = cssvalue.match(new RegExp(`--${variable}\s*:\s*(.+?);`));
  if (!match) {
    return;
  }

  cssvalue = cssvalue.replace(`${match[0]}`, `${match[0].replace(match[1], value)}`).trim();
  console.log(`更新后的css:\n${cssvalue}`);
  $(`style[data-name='${name}']`).text(cssvalue);
}

/**
 * 聊天-添加新角色到列表
 * @param {*} name
 * @param {*} head
 */
function AddNewChar(name: string, head: string) {
  console.log(`添加新角色:${name}  ${head}`);
  let html = _.template(chat_list_item)({ name: name, head: head.trim() });
  $("#QQ_home_chars").append(html);
  QQ_pages.push(name);
  QQ_UserHead.set(name, head);

  // 创建style元素
  const style = $("<style></style>").prop("type", "text/css");

  // 使用模板替换，将CSS文件中的占位符替换为实际值
  const cssRule = chat_head_css
    .replace(/\$\{name\}/g, name)
    .replace(/\$\{head\}/g, head);

  // 添加CSS内容到样式元素
  style.text(cssRule);

  // 将样式添加到页面头部
  $("head").append(style);
}

function getFilenameWithoutExtension(path: string) {
  // 解码URI组件（处理特殊字符）
  const decodedPath = decodeURIComponent(path);
  // 分割路径并获取文件名部分
  const filename = decodedPath.split("/").pop() as string;
  // 找到最后一个点的位置
  const lastDotIndex = filename.lastIndexOf(".");
  // 判断并截取文件名（无后缀）
  return lastDotIndex > 0 ? filename.slice(0, lastDotIndex) : filename;
}

function QQ_page(id: string) {
  if (id == "message") {
    console.log("点击了消息页");

    $("#QQ_home_page").show();
    $("#QQ_space_page").hide();
    $(".QQ_chat_page").hide();

    $("#QQ_message_svg").css("fill", "#019aff");
    $("#QQ_people_svg").css("fill", "#000000");
    $("#QQ_moment_svg").css("fill", "#000000");

    $("#App_QQ").css("background-color", "#ffffff");

    // 切换到消息页时检查联系人状态
    checkContactStatus();
  } else if (id == "people") {
    console.log("点击了联系人");
  } else if (id == "moment") {
    console.log("点击了动态页");

    $("#QQ_home_page").hide();
    $("#QQ_space_page").show();
    $(".QQ_chat_page").hide();

    $("#QQ_moment_svg").css("fill", "#019aff");
    $("#QQ_people_svg").css("fill", "#000000");
    $("#QQ_message_svg").css("fill", "#000000");

    $("#App_QQ").css("background-color", "#ffffff");
    QQ_SetNewTips(0);
    QQ_NewMsg["moment"] = 0;
  }
}

function QQ_SetNewTips(count: number) {
  let tips = $(".new_tips");
  tips.each(function () {
    if (count == 0) {
      $(this).css("display", "none");
    } else {
      $(this).css("display", "flex").text(count);
    }
  });
}

function QQ_HideAllChat() {
  // for (let name of QQ_pages) {
  //   let $page = $(`#QQ_chat_${name}`);
  //   if ($page.length === 0) {
  //     continue;
  //   }
  //   $page.hide();
  // }

  $(`.QQ_chat_page`).hide();
}

function QQ_ChangeChatPage(event: JQuery.TriggeredEvent) {
  const $QQpage = $("#App_QQ");
  if ($QQpage.length === 0) {
    console.log("获取QQpage失败");
    return;
  }
  let element = event.currentTarget as HTMLElement;
  let name = element.getAttribute("data-name") ?? "";
  let $page = $(`.QQ_chat_page[data-name='${name}']`);
  if ($page.length === 0) {
    console.log(`${name}的聊天页不存在,开始创建`);
    $page = $(QQ_CreatChatPage(name));
    $QQpage.append($page);
  }

  QQ_SetHomeTips(name, "0");

  // 添加平滑过渡动画效果
  const $homePage = $("#QQ_home_page");

  // 先给主页添加退出动画
  $homePage.addClass("page-transition-exit");

  // 设置动画完成后的操作
  setTimeout(() => {
    QQ_HideAllChat();
    // 隐藏QQ主页
    $homePage.hide().removeClass("page-transition-exit");

    // 显示聊天页，并添加进入动画
    $page.addClass("page-transition-enter").show();

    // 动画完成后移除class
    setTimeout(() => {
      $page.removeClass("page-transition-enter");
    }, 280);

    console.log(`显示聊天页:QQ_chat_${name}`);

    let $msgContent = $page.find(".msgcontent");
    $msgContent.scrollTop($msgContent[0].scrollHeight);

    let TipsCount = QQ_GetChatShowTipsCount(name);
    const $Tips = $page.find(`.new_tips`);
    $Tips.text(TipsCount);
    if (TipsCount > 0) {
      $Tips.css("display", "flex");
    }
    else {
      $Tips.hide();
    }
  }, 280); // 与退出动画时长一致
}

/**
 * 创建聊天页
 * @param name 聊天页名称
 * @returns 聊天页HTML
 */
function QQ_CreatChatPage(name: string) {
  const html = chat_page.replace(/\$\{name\}/g, name);
  console.log(`创建聊天页:${name}`);

  // 添加这行代码以确保新创建的聊天页面初始化表情菜单
  setTimeout(() => {
    console.log(`为新创建的聊天页面 ${name} 初始化表情菜单`);
    const $emojiMenu = $(`[data-name="${name}"]`).find('.emoji-menu');
    if ($emojiMenu.length > 0) {
      console.log(`找到表情菜单，添加表情`);
      const $grid = $emojiMenu.find(".emoji-grid");
      if ($grid.children().length === 0) {
        emojiList.forEach(emoji => {
          const $item = $(`
            <div class="emoji-item" data-name="${emoji.name}">
              <img src="${emoji.url}" alt="${emoji.name}" loading="lazy">
              <div class="emoji-item-name">${emoji.name}</div>
            </div>
          `);
          $grid.append($item);
        });
        console.log(`已添加${emojiList.length}个表情到新聊天页面`);
      }
    }
  }, 500);

  return html;
}

function QQ_Msg_DelUserKey(content: string) {

  let json = JsonYamlParse(content);
  if (!json) {
    return content;
  }

  let others = "";
  if (`{{user}}` in json.私聊 == false) {
    return content;
  }

  for (let msg of json.私聊[`{{user}}`]) {
    const sp = msg.split("--");
    if (sp.length <= 0) {
      continue;
    }

    if (sp[0] != `{{user}}`) {
      if (!others) {
        others = sp[0];
      }
      else if (sp[0] != others) {
        // 出现第三个名字,过于复杂不做处理
        return content;
      }
    }
  }

  if (!others) {
    // 没取到对方名字
    if (json.私聊[`{{user}}`].length == 0) {
      delete json.私聊[`{{user}}`];
      return JSON.stringify(json);
    }
    return content;
  }

  if (others in json.私聊 == false) {
    // 不存在对方名字键,直接改名
    const newvalue = json.私聊[`{{user}}`];
    delete json.私聊[`{{user}}`];
    json.私聊[others] = newvalue;
    return JSON.stringify(json);
  }
  else if (json.私聊[others].length == 0) {
    // 存在但为空
    const newvalue = json.私聊[`{{user}}`];
    delete json.私聊[`{{user}}`];
    json.私聊[others] = newvalue;
    return JSON.stringify(json);
  }

  return content;
}

function QQ_AddNpcHead(content: string) {
  let json = JsonYamlParse(content);
  if (!json) {
    return content;
  }

  // 头像修复
  const Sections = QQ_CharSettings.getAllSections()
  let newcss = "";
  for (let str in json.私聊) {
    for (const msg of json.私聊[str]) {
      const sp = msg.split("--");
      if (sp.length <= 0) {
        continue;
      }

      const name = sp[0];
      if (!Sections.includes(name) && name != "{{user}}") {
        // 路人,设置随机头像
        if (!NpcCssValue || !NpcCssValue.match(new RegExp(`\\.QQ_chat_head\\[data-name='${name}'\\]`))) {
          newcss += `.QQ_chat_head[data-name='${name}'] {
            background-image: url('${QQ_GetRandomHead()}') !important;}`;
        }
      }
    }
  }

  for (let Group in json.群聊) {
    for (const msg of json.群聊[Group].msgs) {
      const sp = msg.split("--");
      if (sp.length <= 0) {
        continue;
      }

      const name = sp[0];
      if (!Sections.includes(name) && name != "{{user}}") {
        // 路人,设置随机头像
        if (!NpcCssValue || !NpcCssValue.match(new RegExp(`\\.QQ_chat_head\\[data-name='${name}'\\]`))) {
          console.log(`为${name}设置头像`);
          newcss += `.QQ_chat_head[data-name='${name}'] {
            background-image: url('${QQ_GetRandomHead()}') !important;}`;
        }
      }
    }
  }

  if (newcss) {
    NpcCssValue += newcss;
    $(`style[data-name=AutoNpc]`).text(NpcCssValue);
    insertOrAssignVariables({ NpcCssValue: NpcCssValue });
    console.log(`路人随机头像css:\n${NpcCssValue}`);
  }
}

function QQ_Msg_Repair(content: string) {
  let json = JsonYamlParse(content);
  if (!json) {
    return content;
  }

  for (let str in json.私聊) {
    const match = str.match(/(.+?)和(.+?)的聊天/);
    if (!match) {
      // 旧版本只有一个名字
      if (str != `{{user}}`) {
        const value = json.私聊[str];
        delete json.私聊[str];
        json.私聊[`{{user}}和${str}的聊天`] = value;
      }
      else {
        delete json.私聊[str];
      }
      continue;
    }

    if (match[1] != `{{user}}` && match[2] != `{{user}}`) {
      // 俩角色之间的私聊,属于特殊情况直接删了
      console.log(`删除:${str}`);
      delete json.私聊[str];
      continue;
    }

    if (match[1] != `{{user}}` && match[2] == `{{user}}`) {
      // 顺序反了
      const value = json.私聊[str];
      delete json.私聊[str];
      json.私聊[`{{user}}和${match[1]}的聊天`] = value;
    }
  }

  QQ_AddNpcHead(JSON.stringify(json));
  return YAML.stringify(json);
}

/**
 * 初始化时解析聊天消息
 * @param content 聊天消息内容
 */
function QQ_Msg_Parse(content: string) {

  content = QQ_Msg_Repair(content);

  console.log(`开始解析聊天消息:${content}`);
  let hasstr = false;
  if (content.match(/\S/)) {
    hasstr = true;
  }
  let json = JsonYamlParse(content);
  if (!json) {
    if (hasstr) {
      QQ_Error(`解析聊天记录失败,请手动解决`);
    }
    //QQ_Error(`yaml解析失败`);
    return;
  }
  const $QQpage = $("#App_QQ");
  if ($QQpage.length === 0) {
    console.log("获取QQpage失败");
    return;
  }
  for (let str in json.私聊) {
    const match = str.match(/(.+?)和(.+?)的聊天/);
    if (!match) {
      continue;
    }
    let name = "";
    if (match[1] != `{{user}}`) {
      name = match[1];
    }
    else if (match[2] != `{{user}}`) {
      name = match[2];
    }
    else {
      continue;
    }

    try {
      if (!QQ_msgjson.私聊[str]) {
        QQ_msgjson.私聊[str] = [];
      }
      if (!QQ_NewMsg[name]) {
        QQ_NewMsg[name] = {};
      }
      if (!$(`.QQ_home_usermsg[data-name='${name}']`).length && name != "{{user}}") {
        console.log(`${name}的主页不存在,开始创建`);
        AddNewChar(name, "");
      }
      let $page = $(`.QQ_chat_page[data-name='${name}']`);
      let Creat = false;
      if ($page.length === 0) {
        Creat = true;
        console.log(`${name}的聊天页不存在,开始创建123`);
        $page = $(QQ_CreatChatPage(`${name}`));
        $QQpage.append($page);
      }
      if (json.私聊[str].length == 0) {
        continue;
      }
      let $msgContent = $page.find(".msgcontent");

      let NewMsgCount = 0;
      let LastTime = "";
      let LastMsg = "";
      for (let msg of json.私聊[str]) {
        QQ_Chat_AddMsg($msgContent[0], msg, name, false);
        QQ_msgjson.私聊[str].push(msg);

        let sp = msg.split("--");
        if (sp.length >= 2) {
          if (sp[0] == "{{user}}") {
            User_LastMsgMap.私聊[name] = `${sp[0]}--${sp[1]}`;
            NewMsgCount = 0;
          } else if (sp[0] == name) {
            if (sp.length >= 3) {
              Char_LastMsgMap.私聊[name] = `${sp[0]}--${sp[1]}--${sp[2]}`;
            }
            else {
              Char_LastMsgMap.私聊[name] = `${sp[0]}--${sp[1]}`;
            }
            NewMsgCount += 1;
          }
        }
        if (sp.length >= 3) {
          LastTime = sp[2];
        }
        LastMsg = sp[1];
      }

      // 设置红点和首页显示的消息
      if ($(`#QQ_chat_${name}`).css("display") != "none" && !Creat) {
        //console.log(`display不为none,红点为0  ${$(`#QQ_chat_${name}`).css("display")}`)
        NewMsgCount = 0;
      }
      $(`.QQ_home_usermsg[data-name='${name}'] .QQ_home_lastmsg`).text(LastMsg);
      $(`.QQ_home_usermsg[data-name='${name}'] .QQ_home_lasttime`).text(LastTime);
      QQ_SetHomeTips(name, NewMsgCount);
      $msgContent.scrollTop($msgContent[0].scrollHeight);
    } catch (error) {
      throw error;
      //QQ_Error(error.message);
    }
  }

  for (let name in json.群聊) {
    try {
      if (!QQ_msgjson.群聊[name]) {
        QQ_msgjson.群聊[name] = {};
        QQ_msgjson.群聊[name]["menbers"] = json.群聊[name]["menbers"];
        QQ_msgjson.群聊[name]["msgs"] = [];
      }
      if (!$(`.QQ_home_usermsg[data-name='${name}']`).length) {
        console.log(`${name}的主页不存在,开始创建`);
        AddNewChar(name, "http://");
      }
      if (!QQ_Groups.includes(name)) {
        QQ_Groups.push(name);
      }
      let $page = $(`.QQ_chat_page[data-name='${name}`);
      let Creat = false;
      if ($page.length === 0) {
        Creat = true;
        console.log(`${name}的聊天页不存在,开始创建`);
        $page = $(QQ_CreatChatPage(name));
        $QQpage.append($page);
      }
      let $msgContent = $page.find(".msgcontent");
      if (json.群聊[name]["msgs"].length == 0) {
        console.log(`数组空,跳出`);
        continue;
      }

      let NewMsgCount = 0;
      let LastTime = "";
      let LastMsg = "";
      for (let msg of json.群聊[name]["msgs"]) {
        QQ_Chat_AddMsg($msgContent[0], msg, name, true);
        //console.log(`在群聊:${name}中添加消息:${msg}`);
        QQ_msgjson.群聊[name]["msgs"].push(msg);

        let sp = msg.split("--");
        if (sp.length >= 2) {
          if (sp[0] == "{{user}}") {
            User_LastMsgMap.群聊[name] = `${sp[0]}--${sp[1]}`;
            NewMsgCount = 0;
          } else {
            if (sp.length >= 3) {
              Char_LastMsgMap.群聊[name] = `${sp[0]}--${sp[1]}--${sp[2]}`;
            }
            else {
              Char_LastMsgMap.群聊[name] = `${sp[0]}--${sp[1]}`;
            }
            NewMsgCount += 1;
          }
        }
        if (sp.length >= 3) {
          LastTime = sp[2];
        }
        LastMsg = `${sp[0]}:${sp[1]}`;
      }

      // 设置红点和首页显示的消息
      if ($(`#QQ_chat_${name}`).css("display") != "none" && !Creat) {
        NewMsgCount = 0;
      }
      $(`.QQ_home_usermsg[data-name='${name}'] .QQ_home_lastmsg`).text(LastMsg);
      $(`.QQ_home_usermsg[data-name='${name}'] .QQ_home_lasttime`).text(LastTime);
      QQ_SetHomeTips(name, NewMsgCount);
      console.log(`群聊的未读消息数量:${NewMsgCount}`);

      $msgContent.scrollTop($msgContent[0].scrollHeight);
    } catch (error) {
      assertIsError(error);
      QQ_Error(error.message);
    }
  }

  console.log(
    `User_LastMsgMap:\n${JSON.stringify(
      User_LastMsgMap
    )}\nChar_LastMsgMap:\n${JSON.stringify(Char_LastMsgMap)}`
  );
}


function QQ_SetHomeTips(name: string, count: any) {
  $(`.QQ_home_usermsg[data-name='${name}'] .QQ_home_usermsg_new`).text(count);
  if (count == 0) {
    $(`.QQ_home_usermsg[data-name='${name}'] .QQ_home_usermsg_new`).hide();
  }
  else {
    $(`.QQ_home_usermsg[data-name='${name}'] .QQ_home_usermsg_new`).show();
  }

  console.log(`设置${name}的首页红点:${count}`);
  QQ_NewMsg[name] = count;
}

function QQ_GetChatShowTipsCount(name: string) {
  let count = 0;
  for (const n in QQ_NewMsg) {
    if (n != name) {
      count += Number(QQ_NewMsg[n]);
    }
  }

  return count;
}

function QQ_Moment_Parse(content: string) {
  const lines = content.split(/\r?\n/g);
  let momentdiv;
  let list;
  let count = QQ_NewMsg["moment"] || 0;
  for (const line of lines) {
    console.log(`解析动态行内容:${line}`);

    // 使用非贪婪匹配确保捕获所有内容
    let match = line.match(/(.+?)--(.+?)--(.+?)--(.+?)--(.+)/);
    if (match) {
      // 是新动态内容
      const author = match[1];
      const msgContent = match[2]; // 内容部分
      const timestamp = match[3];
      const views = match[4];
      const likes = match[5];

      console.log(`解析动态详情: 作者=${author}, 内容=${msgContent}, 时间=${timestamp}, 浏览=${views}, 点赞=${likes}`);

      // 将完整格式存入QQ_momentjson中
      const str = `${author}--${msgContent}`;
      if (!(str in QQ_momentjson)) {
        QQ_momentjson[str] = [];
      }

      console.log(`匹配到动态内容:${match[0]}`);
      if (momentdiv) {
        count += 1;
        $("#space_contents").prepend(momentdiv);
      }

      let fakeimg = "";
      let message = msgContent;

      // 防止空内容
      if (!message || message.trim() === "") {
        console.log(`警告：动态内容为空，使用默认内容`);
        message = "无内容"; // 设置默认内容，防止空内容
      }

      const matches = message.matchAll(/\[img-(.+?)\]/g);
      if (matches) {
        for (const m of matches) {
          message = message.replace(m[0], "");
          fakeimg += `\n<div class="space_fakeimg">${m[1]}</div>`;
        }
      }

      momentdiv = $("<div>", { class: "user_moment" });
      momentdiv.html(
        _.template(moment_page)({
          userHead: QQ_GetUserHead(author),
          userName: author,
          message: message,
          timestamp: timestamp,
          additionalInfo: views,
          randomPhone: QQ_GetRandomPhone(),
          extraContent: likes,
          imgcontent: fakeimg
        })
      );
      list = momentdiv.find(".user_leave_message_list");
      continue;
    }

    match = line.match(/^(.+?)[:：](.+)$/m);
    if (match && momentdiv && list) {
      // 是评论内容
      console.log(`评论人:${match[1]}  评论内容:${match[2]}`)
      let messageDiv = $("<div>", { class: "user_leave_message" });
      messageDiv.html(`<span><strong>${match[1]}</strong>：${match[2]}</span>`);
      list.append(messageDiv);
    }
  }
  if (momentdiv) {
    count += 1;
    $("#space_contents").prepend(momentdiv);
  }

  QQ_NewMsg["moment"] = count;
  QQ_SetNewTips(count);

  // 绑定动态评论输入框和发送按钮事件
  bindMomentCommentEvents();
}

/**
 * 绑定动态评论输入框和发送按钮事件
 */
function bindMomentCommentEvents() {
  // 移除旧事件以避免重复绑定
  $(".user_moment").off("click keypress", ".moment-send-btn, input");

  // 绑定评论发送按钮点击事件
  $(".user_moment").on("click", "svg[viewBox='0 0 1024 1024'][width='20']", function (e) {
    const $momentDiv = $(this).closest(".user_moment");
    const $input = $momentDiv.find("input[placeholder='说点什么吧...']");
    const comment = $input.val()?.toString().trim();

    if (comment) {
      QQ_Moment_SendComment($momentDiv, comment);
      $input.val(""); // 清空输入框
    }
  });

  // 绑定回车键发送评论
  $(".user_moment").on("keypress", "input[placeholder='说点什么吧...']", function (e) {
    if (e.which === 13) { // 回车键的keyCode是13
      const $momentDiv = $(this).closest(".user_moment");
      const comment = $(this).val()?.toString().trim();

      if (comment) {
        QQ_Moment_SendComment($momentDiv, comment);
        $(this).val(""); // 清空输入框
      }

      e.preventDefault(); // 阻止默认行为
    }
  });
}

/**
 * 发送动态评论并生成回复
 * @param $momentDiv 动态DOM元素
 * @param comment 评论内容
 */
async function QQ_Moment_SendComment($momentDiv: JQuery, comment: string) {
  if (gening) {
    triggerSlash("/echo 生成中,请勿重复发送");
    return;
  }

  // 获取动态信息
  const userName = $momentDiv.find(".user_moment_title strong").text();
  const momentContent = $momentDiv.find("span[style='font-size: 15px; line-height: 1.3']").text();
  const $commentsList = $momentDiv.find(".user_leave_message_list");

  console.log(`给${userName}的动态"${momentContent}"发表评论: ${comment}`);

  // 先添加用户的评论到UI
  let userCommentDiv = $("<div>", { class: "user_leave_message" });
  userCommentDiv.html(`<span><strong>{{user}}</strong>：${comment}</span>`);
  $commentsList.append(userCommentDiv);

  // 保存用户评论到QQ_momentjson
  const momentKey = `${userName}--${momentContent}`;
  if (!QQ_momentjson[momentKey]) {
    QQ_momentjson[momentKey] = [];
  }
  QQ_momentjson[momentKey].push(`{{user}}:${comment}`);

  // 构建生成请求
  const genPrompt = `<本次响应必须遵守线上模式格式>回复${userName}的动态"${momentContent}":${comment}
<Request:{{user}}在${userName}的动态下评论了，请${userName}回复{{user}}的评论，只输出对方的回复即可，禁止重复输出前面的内容，回复用"moment_start\n${userName}:回复内容\nmoment_end"格式>`;

  gening = true;
  let result;

  try {
    // 调用生成
    result = await ST.Gen(genPrompt);
  } finally {
    gening = false;
    console.log(`生成结束`);
  }

  if (!result) {
    triggerSlash("/echo 生成回复失败");
    return;
  }

  // 解析生成结果
  const momentMatches = result.match(/moment_start\s*([\s\S]*?)\s*moment_end/);
  if (momentMatches && momentMatches[1]) {
    // 解析回复内容
    const replyMatch = momentMatches[1].match(/^(.+?)[:：](.+)$/m);
    if (replyMatch) {
      // 添加回复到评论列表
      let replyDiv = $("<div>", { class: "user_leave_message" });
      replyDiv.html(`<span><strong>${replyMatch[1]}</strong>：${replyMatch[2]}</span>`);
      $commentsList.append(replyDiv);
      console.log(`添加评论回复: ${replyMatch[1]}:${replyMatch[2]}`);

      // 保存回复到QQ_momentjson
      QQ_momentjson[momentKey].push(`${replyMatch[1]}:${replyMatch[2]}`);
    } else {
      // 直接显示原始回复
      let replyDiv = $("<div>", { class: "user_leave_message" });
      replyDiv.html(`<span><strong>${userName}</strong>：${momentMatches[1].trim()}</span>`);
      $commentsList.append(replyDiv);
      console.log(`添加评论回复(无格式): ${userName}:${momentMatches[1].trim()}`);

      // 保存回复到QQ_momentjson
      QQ_momentjson[momentKey].push(`${userName}:${momentMatches[1].trim()}`);
    }
  } else {
    // 没有找到合适的回复格式，尝试自己解析
    const directReplyMatch = result.match(/^(.+?)[:：](.+)$/m);
    if (directReplyMatch) {
      let replyDiv = $("<div>", { class: "user_leave_message" });
      replyDiv.html(`<span><strong>${directReplyMatch[1]}</strong>：${directReplyMatch[2]}</span>`);
      $commentsList.append(replyDiv);
      console.log(`添加直接评论回复: ${directReplyMatch[1]}:${directReplyMatch[2]}`);

      // 保存回复到QQ_momentjson
      QQ_momentjson[momentKey].push(`${directReplyMatch[1]}:${directReplyMatch[2]}`);
    } else {
      triggerSlash("/echo 无法解析生成的回复");
      console.log("生成回复无法解析:", result);
    }
  }

  // 保存动态内容到当前消息
  await QQ_Save_Moment();
}

function QQ_GetUserHead(name: string) {
  if (QQ_UserHead.has(name)) {
    return QQ_UserHead.get(name);
  } else {
    return QQ_GetRandomHead();
  }
}

function QQ_GetRandomHead() {
  // return `http://sharkpan.xyz/f/${random_head_list[Math.floor(Math.random() * random_head_list.length)]
  //   }`;
  if (QQ_RandomHead.length === 0) return null; // 处理空数组

  let minCount = Infinity;
  const candidates: { [key: string]: any }[] = [];

  // 一次遍历找到最小值和候选对象
  for (const obj of QQ_RandomHead) {
    if (obj.count < minCount) {
      minCount = obj.count;
      candidates.length = 0; // 清空数组，重置候选
      candidates.push(obj);
    } else if (obj.count === minCount) {
      candidates.push(obj);
    }
  }

  // 随机选择一个（即使只有一个元素也适用）
  const selected = candidates[Math.floor(Math.random() * candidates.length)];
  selected.count++; // 直接修改原对象
  console.log(`取出来的随机头像:${selected.url}`);
  return selected.url;
}

let Phone = [
  "小米",
  "华为",
  "苹果",
  "三星",
  "魅族",
  "一加",
  "oppo",
  "vivo",
  "真我",
  "红米",
];
let Phone_lvl = ["pro", "max", "mate", "ultra", "plus"];
function QQ_GetRandomPhone() {
  let name = Phone[Math.floor(Math.random() * Phone.length)];
  name += random(6, 19);
  let count = random(1, Phone_lvl.length);
  let a: string[] = [];
  for (let i = 0; i < count; i++) {
    let randomresult = Phone_lvl[random(0, Phone_lvl.length)];
    if (!a.includes(randomresult)) {
      a.push(randomresult);
    }
  }
  name += " " + a.join(" ");
  return name;
}

function QQ_Chat_AddMsg(element: HTMLElement, msg: string, name: string, isgroup?: boolean) {

  if (!QQ_NewMsg[name]) {
    QQ_NewMsg[name] = {};
  }

  const match = msg.match(/(.+?)--(.+?)--(.+)/);
  if (!match) {
    QQ_NewMsg[name].Count = 0;
    return QQ_Chat_AddUserMsg(element, msg);
  } else if (match[1] == `{{user}}`) {
    QQ_NewMsg[name].Count = 0;
    return QQ_Chat_AddUserMsg(element, `${match[1]}--${match[2]}`);
  }

  QQ_NewMsg[name].Count += 1;

  const content = QQ_Chat_SpecialMsg(match[2], match[1], isgroup);
  const html = _.template(chat_char_msg)({
    name: match[1],
    content: content,
    isgroup: isgroup || false,
  });

  $(element).append(html);
}

function QQ_Chat_AddUserMsg(element: HTMLElement, msg: string) {
  const match = msg.match(/(.+?)--(.+)/);
  if (!match) {
    return;
  }
  const content = QQ_Chat_SpecialMsg(match[2], "{{user}}", false, true);
  const html = _.template(chat_user_message)({ content });
  $(element).append(html);
}

/**
 * 处理特殊格式消息
 * @param msg 消息内容
 * @param isgroup 是否是群聊
 * @returns 处理后的消息
 */
function QQ_Chat_SpecialMsg(msg: string, username: string, isgroup?: boolean, mysend?: boolean) {
  const match = msg.match(/\[(.+?)[\|-](.+?)\]/);
  const xxx = msg.match(/(.+?)\[/);
  const xx = msg.match(/\](.+)/);
  let additionalText = "";
  if (xxx) {
    additionalText = xxx[1];
  }
  if (xx) {
    console.log(`前后都有`);
    additionalText = additionalText ? additionalText + `<br>${xx[1]}` : xx[1];
  }

  if (!match) {
    // 使用普通消息模板
    //console.log(`自己的消息,使用的普通模板`);
    return _.template(chat_normal_message)({
      message: msg,
      isgroup: isgroup || false,
      username: username
    });
  }

  const type = match[1];
  if (type == "bqb") {
    // 使用表情包消息模板
    const emojiUrl = QQ_GetEmoji(match[2]);
    console.log(`表情包处理: ${match[2]}, 链接: ${emojiUrl}`);

    if (!emojiUrl) {
      console.error(`表情包链接获取失败: ${match[2]}`);
      // 尝试直接从emojiList获取
      const emoji = emojiList.find(e => e.name === match[2]);
      if (emoji) {
        console.log(`直接从emojiList获取表情: ${emoji.url}`);
        return _.template(chat_emoji_message)({
          emojiUrl: emoji.url,
          additionalText: additionalText,
          isgroup: isgroup || false,
          username: username
        });
      }
      return `表情包-${match[2]} (未找到)`;
    }

    return _.template(chat_emoji_message)({
      emojiUrl: emojiUrl,
      additionalText: additionalText,
      isgroup: isgroup || false,
      username: username
    });
  } else if (type == "转账" || type == "zz") {
    // 使用转账消息模板
    return _.template(chat_transfer_message)({
      amount: match[2],
    });
  }
  else if (type == "yy") {
    let file = chat_voice_message;
    if (mysend) {
      file = chat_myvoice_message;
    }
    return _.template(file)({
      content: match[2],
      time: Math.ceil((match[2].length / 4)).toString(),
      isgroup: isgroup || false,
      username: username
    });
  }
  else if (["img", "image", "video", "imgs", "images", "file", "files", "图片", "视频", "tp"].includes(type)) {
    return _.template(chat_fakeimg_message)({
      isgroup: isgroup || false,
      username: username,
      content: match[2]
    });
  }
  else if (["music", "音乐"].includes(type)) {
    let sp = match[2].split("$");
    let musicname = "";
    let musicauthor = "";
    if (sp.length >= 2) {
      musicname = sp[0];
      musicauthor = sp[1];
    }
    //console.log(`加入音乐:${musicname}----${musicauthor}`);
    return _.template(chat_music_message)({
      isgroup: isgroup || false,
      username: username,
      musicname: musicname,
      musicauthor: musicauthor
    });
  }
  return "";
}

function QQ_MySendSpecial(content: string) {
  let match = content.match(/\[?(.+?)-(.+?)]?$/m);
  if (match) {
    let type = match[1];
    if (["yy", "语音",].includes(type)) {
      content = `[yy-${match[2]}]`;
    }
    else if (["表情包", "表情", "bqb", "bq"].includes(type)) {
      content = `[bqb-${match[2]}]`;
    }
    else if (["img", "image", "video", "imgs", "images", "file", "files", "图片", "视频", "tp"].includes(type)) {
      content = `[img-${match[2]}]`;
    }
  }

  return content;
}

/**
 * 获取表情包
 * @param name 表情包名称
 * @returns 表情包URL
 */
function QQ_GetEmoji(name: string) {
  console.log(`尝试获取表情 ${name}，表情库大小: ${QQ_emoji.size}`);
  if (!QQ_emoji.has(name)) {
    console.warn(`找不到表情: ${name}`);
    // 从emojiList中查找
    const emoji = emojiList.find(e => e.name === name);
    if (emoji) {
      console.log(`从emojiList找到表情: ${emoji.url}`);
      return emoji.url;
    }
    return null;
  }
  const url = QQ_emoji.get(name);
  console.log(`找到表情URL: ${url}`);
  return url;
}

// 当前正在设置的聊天对象
let currentSettingChatName = "";

/**
 * 设置聊天页设置
 * @param event 事件对象
 */
function QQ_SetChatPageSetting(event: JQuery.TriggeredEvent) {
  console.log("点击了设置聊天页设置");
  let element = event.currentTarget;
  // 获取当前聊天页的名称
  const chatPageElement = $(element).closest('.QQ_chat_page');
  if (chatPageElement.length === 0) {
    console.error("无法获取当前聊天页");
    return;
  }
  currentSettingChatName = chatPageElement.attr("data-name") ?? "";
  console.log(`打开聊天设置页面，当前聊天对象: ${currentSettingChatName}`);

  // 添加遮罩层和弹窗到页面
  if ($(".popup-overlay").length === 0) {
    $(".card").append('<div class="popup-overlay"></div>');
  }

  if ($(".chat-setting-popup").length === 0) {
    $(".card").append(chat_page_setting.replace("${username}", currentSettingChatName));
    const bubblecolorPicker = document.getElementById('bubble-color');
    if (bubblecolorPicker) {
      console.log(`开始监听`);
      bubblecolorPicker.addEventListener('input', (event) => {
        const color = (event.target as HTMLInputElement).value;
        $("#bubble-color-input").val(color || "#ffffff");
        $("#chat-setting-preview").each(function () {
          this.style.setProperty('background-color', color, 'important');
        });
      });
    }

    const TextcolorPicker = document.getElementById('text-color');
    if (TextcolorPicker) {
      console.log(`开始监听`);
      TextcolorPicker.addEventListener('input', (event) => {
        const color = (event.target as HTMLInputElement).value;
        $("#text-color-input").val(color || "#ffffff");
        $("#chat-setting-preview").each(function () {
          const spans = this.querySelectorAll('span');
          spans.forEach(span => {
            span.style.setProperty('color', color, 'important');
          });
        });
      });
    }
  }

  // 填充已有设置
  loadCurrentSettings(currentSettingChatName);

  // 显示弹窗和遮罩层
  $(".popup-overlay").show();
  $(".chat-setting-popup").show();
}

/**
 * 加载当前设置到弹窗
 * @param chatName 聊天对象名称
 */
function loadCurrentSettings(chatName: string) {
  const setting = GetChatCharSettingByName(chatName);

  // 填充表单
  let bubbleColor = QQ_CharSettings.readValue(chatName, "气泡颜色");
  let TextColor = QQ_CharSettings.readValue(chatName, "字体颜色");
  let chatBg = QQ_CharSettings.readValue(chatName, "聊天壁纸");

  if (bubbleColor && bubbleColor[0] !== "#") {
    bubbleColor = "#" + bubbleColor;
  }
  if (TextColor && TextColor[0] !== "#") {
    TextColor = "#" + TextColor;
  }

  $("#bubble-color").val(bubbleColor || "#ffffff");
  $("#bubble-color-input").val(bubbleColor || "#ffffff");
  $("#text-color").val(TextColor || "#ffffff");
  $("#text-color-input").val(TextColor || "#ffffff");
  $("#chat-bg").val(chatBg || "");
  $("#chat-setting-preview").each(function () {
    this.style.setProperty('background-color', bubbleColor, 'important');
    const spans = this.querySelectorAll('span');
    spans.forEach(span => {
      span.style.setProperty('color', TextColor, 'important');
    });
  });
}

function closeSettingPopup() {
  $(".popup-overlay").hide();
  $(".chat-setting-popup").hide();
}

/**
 * 保存设置并关闭弹窗
 */
async function saveSettingAndClose() {
  if (!currentSettingChatName) {
    console.error("未知的聊天对象");
    return;
  }

  // 获取设置值
  const bubbleColor = ($("#bubble-color-input").val() as string) || "";
  const TextColor = ($("#text-color-input").val() as string) || "";
  const chatBg = ($("#chat-bg").val() as string) || "";

  console.log(`保存聊天设置: ${currentSettingChatName}`, {
    bubbleColor,
    TextColor,
    chatBg,
  });

  QQ_CharSettings.writeValue(currentSettingChatName, "气泡颜色", bubbleColor);
  QQ_CharSettings.writeValue(currentSettingChatName, "字体颜色", TextColor);
  QQ_CharSettings.writeValue(currentSettingChatName, "聊天壁纸", chatBg);
  const result = QQ_CharSettings.getAllText();

  for (let entry of entries) {
    if (entry.comment == "手机-角色" || entry.comment == "手机界面-角色") {
      await setLorebookEntries(worldbook, [
        { uid: entry.uid, content: result },
      ]);
      break;
    }
  }

  SetCssVariable(currentSettingChatName, "MsgColor", bubbleColor);
  SetCssVariable(currentSettingChatName, "TextColor", TextColor);
  SetCssVariable(currentSettingChatName, "BackGroundImg", `url('${chatBg}')`);

  // 关闭弹窗
  closeSettingPopup();
}

function updateTime() {
  const timeElement = document.getElementById("time");
  if (!timeElement) {
    return;
  }

  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  //const seconds = String(now.getSeconds()).padStart(2, '0');
  timeElement.textContent = `${hours}:${minutes}`;

  // const dayElement = document.getElementById("day");
  // dayElement.textContent = `${now.getMonth() + 1}月${now.getDate()}日`;
}

function App_Load(App_Name: string) {
  $("#Home_page").hide();
  $("#App_page").show();
  App_HideAll();
  $(`#App_${App_Name}`).show();
}

function App_HideAll() {
  const AppNames = ["QQ", "twitter"];
  for (const name of AppNames) {
    $(`#App_${name}`).hide();
  }
}

// 每秒更新一次时间
setInterval(updateTime, 1000);
updateTime();

/**
 * 初始化表情按钮和表情菜单
 */
function initEmojiMenu() {
  console.log("初始化表情菜单...");

  // 立即在页面加载时为所有表情菜单添加表情项
  function addEmojisToMenu() {
    console.log("添加表情到菜单中...");
    $('.emoji-menu').each(function (index) {
      const $menu = $(this);
      const $grid = $menu.find(".emoji-grid");

      console.log(`处理第${index + 1}个表情菜单，当前子元素数量: ${$grid.children().length}`);

      // 如果网格已经有内容，则不重复添加
      if ($grid.children().length > 0) {
        console.log("该菜单已有表情，跳过");
        return;
      }

      // 添加表情到网格
      emojiList.forEach(emoji => {
        const $item = $(`
          <div class="emoji-item" data-name="${emoji.name}">
            <img src="${emoji.url}" alt="${emoji.name}" loading="lazy">
            <div class="emoji-item-name">${emoji.name}</div>
          </div>
        `);
        $grid.append($item);
      });

      console.log(`已添加${emojiList.length}个表情到菜单${index + 1}`);
    });
  }

  // 确保DOM准备好后添加表情
  $(document).ready(function () {
    console.log("文档已准备好，添加表情...");
    // 先执行一次，然后延迟再执行一次以确保所有动态添加的元素都已加载
    addEmojisToMenu();
    setTimeout(addEmojisToMenu, 1000);
  });

  // 为所有表情按钮添加点击事件
  $(document).on("click", ".emoji-btn", function (event) {
    event.stopPropagation();
    console.log("表情按钮被点击");

    // 关闭所有其他表情菜单
    $(".emoji-menu").not($(this).parent().find(".emoji-menu")).hide();

    const $menu = $(this).parent().find(".emoji-menu");
    console.log(`找到表情菜单，内部表情数量: ${$menu.find(".emoji-item").length}`);

    // 如果菜单为空则填充表情包
    if ($menu.find(".emoji-grid").children().length === 0) {
      console.log("菜单为空，添加表情");
      addEmojisToMenu();
    }

    // 切换菜单显示状态
    $menu.toggle();
    console.log(`表情菜单显示状态: ${$menu.is(":visible") ? "显示" : "隐藏"}`);
  });

  // 添加点击表情选择的事件
  $(document).on("click", ".emoji-item", function (e) {
    e.stopPropagation();
    const emojiName = $(this).data("name");
    console.log(`选择了表情: ${emojiName}`);

    const $container = $(this).closest(".QQ_chat_page");
    const $msgContent = $container.find(".msgcontent");
    const name = $container.attr("data-name") || "未知用户";

    // 使用[bqb-表情名]格式，这会被QQ_Chat_SpecialMsg函数正确处理为表情图片
    const content = `[bqb-${emojiName}]`;

    // 处理表情消息为HTML并添加到聊天记录
    const SpecialHtml = QQ_Chat_SpecialMsg(content, "{{user}}", false, true);
    const html = _.template(chat_user_message)({ content: SpecialHtml });

    console.log(`发送表情: ${content} 对象: ${name}`);
    $msgContent.append(html);
    $msgContent.scrollTop($msgContent[0].scrollHeight);

    // 清空输入框
    $container.find(".userInput").val("");

    // 如果需要，将消息添加到缓存但不触发AI生成
    if (QQ_Groups.includes(name)) {
      QQ_CacheSendMsg += `\n<本次响应必须遵守线上模式格式>在群聊${name}中发送:${content}`;
    } else {
      QQ_CacheSendMsg += `\n<本次响应必须遵守线上模式格式>给${name}发消息:${content}`;
    }

    // 隐藏表情菜单
    $(this).closest(".emoji-menu").hide();
  });

  // 点击页面其他位置时关闭表情菜单
  $(document).on("click", function (event) {
    if (!$(event.target).closest(".emoji-btn-container").length) {
      $(".emoji-menu").hide();
    }
  });
}

/**
 * 保存动态内容到当前消息
 */
async function QQ_Save_Moment() {
  if (!QQ_momentjson) {
    console.log("QQ_momentjson为空，无法保存动态内容");
    return;
  }

  console.log("开始保存动态内容，QQ_momentjson:", JSON.stringify(QQ_momentjson));

  const CurrentMessageId = getCurrentMessageId();
  const Messages = await getChatMessages(CurrentMessageId);
  if (!Messages) {
    console.log(`获取楼层记录失败`);
    return;
  }

  let msg = Messages[0].message;

  // 构建动态内容字符串
  let momentContent = "";
  for (const key in QQ_momentjson) {
    if (QQ_momentjson[key] && QQ_momentjson[key].length > 0) {
      // 解析原始动态内容
      const parts = key.split("--");
      if (parts.length === 2) {
        const author = parts[0];
        const content = parts[1];

        if (!content || content.trim() === "") {
          console.log(`警告：发现空内容动态 [${author}--]，跳过保存`);
          continue;
        }

        console.log(`保存动态: 作者=${author}, 内容=${content}`);

        // 查找原始动态的完整格式（包含时间、浏览次数和点赞数）
        let found = false;
        const regexPattern = new RegExp(`${author}--${escapeRegExp(content)}--(.+?)--(.+?)--(.+)`, 'g');
        const matches = [...msg.matchAll(regexPattern)];

        if (matches.length > 0 && matches[0].length >= 6) {
          // 找到完整动态，添加到内容中
          console.log(`找到动态完整格式: ${matches[0][0]}`);
          momentContent += `\nmoment_start\n${author}--${content}--${matches[0][3]}--${matches[0][4]}--${matches[0][5]}\n`;
          found = true;
        }

        if (!found) {
          // 找不到完整动态，使用默认值
          const currentTime = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
          console.log(`未找到动态完整格式，使用默认值: ${author}--${content}--${currentTime}--0--0`);
          momentContent += `\nmoment_start\n${author}--${content}--${currentTime}--0--0\n`;
        }

        // 添加评论
        if (QQ_momentjson[key].length > 0) {
          console.log(`添加${QQ_momentjson[key].length}条评论`);
          for (const comment of QQ_momentjson[key]) {
            momentContent += comment + "\n";
          }
        }

        momentContent += "moment_end\n";
      }
    }
  }

  if (!momentContent) {
    console.log("没有有效动态内容需要保存");
    return;
  }

  // 替换或添加动态内容
  let existingMoments = msg.match(/moment_start[\s\S]+?moment_end/g);
  if (existingMoments) {
    // 替换现有动态内容
    console.log(`找到${existingMoments.length}个现有动态内容，准备替换`);
    msg = msg.replace(/moment_start[\s\S]+?moment_end/g, "");
  }

  // 确保所有moment内容被包含在MiPhone标签内
  let miPhoneStart = "MiPhone_start";
  let miPhoneEnd = "MiPhone_end";
  const miPhoneMatch = msg.match(/MiPhone_start([\s\S]+?)MiPhone_end/);

  if (miPhoneMatch) {
    // 如果已经有MiPhone标签，在其内部添加moment内容
    console.log("在现有MiPhone标签内添加动态内容");
    const miPhoneContent = miPhoneMatch[1];
    const newMiPhoneContent = miPhoneContent + momentContent;
    msg = msg.replace(miPhoneMatch[0], `${miPhoneStart}${newMiPhoneContent}${miPhoneEnd}`);
  } else {
    // 如果没有MiPhone标签，添加带有moment内容的MiPhone标签
    console.log("未找到MiPhone标签，创建新标签");
    msg += `\n${miPhoneStart}${momentContent}${miPhoneEnd}`;
  }

  // 保存消息
  setChatMessage({ message: msg }, CurrentMessageId, { refresh: "none" });
  console.log("动态内容已成功保存");
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
