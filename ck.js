/*
打开京东以后点击右上角信息标志，
即可获取完整 pt_key 和 pt_pin，适用于新旧版本京东通用

[MITM]
hostname=api.m.jd.com

[rewrite_local]
# 京东Cookie获取 - 自动上传到青龙面板
^https:\/\/api\.m\.jd\.com\/client\.action\? url script-request-body https://raw.githubusercontent.com/Winencey/jd_boxjs/main/ck.js
*/

// 京东Cookie抓取与青龙面板上传脚本 - BoxJS配置版
const $ = new Env("JD Cookie to QingLong Pro");

// 从BoxJS配置读取青龙面板设置
function getQLConfigFromBoxJS() {
    const address = $.getdata('ql_address') || $.getdata('@ql.address') || "";
    const client_id = $.getdata('ql_client_id') || $.getdata('@ql.client_id') || "";
    const client_secret = $.getdata('ql_client_secret') || $.getdata('@ql.client_secret') || "";
    const limit_count = parseInt($.getdata('ql_limit_count') || $.getdata('@ql.limit_count') || "999");
    const auto_upload = ($.getdata('ql_auto_upload') || $.getdata('@ql.auto_upload')) !== "false";
    const notify_enabled = ($.getdata('ql_notify_enabled') || $.getdata('@ql.notify_enabled')) !== "false";
    
    const retry_count = parseInt($.getdata('cookie_retry_count') || $.getdata('@cookie.retry_count') || "3");
    const timeout = parseInt($.getdata('cookie_timeout') || $.getdata('@cookie.timeout') || "10") * 1000;
    const save_local = ($.getdata('cookie_save_local') || $.getdata('@cookie.save_local')) !== "false";
    
    // 检查必填项是否为空
    if (!address || !client_id || !client_secret) {
        console.log("❌❌ 青龙面板配置不完整，请先在BoxJS中配置");
        sendNotification("配置错误", "青龙面板配置不完整", "请在BoxJS中填写青龙面板连接信息");
        return null;
    }
    
    return {
        QINGLONG_CONFIGS: [{
            address: address,
            client_id: client_id,
            client_secret: client_secret,
            limit_count: limit_count
        }],
        settings: {
            auto_upload: auto_upload,
            notify_enabled: notify_enabled,
            retry_count: retry_count,
            timeout: timeout,
            save_local: save_local
        }
    };
}

const CONFIG = getQLConfigFromBoxJS();
if (!CONFIG) {
    $done();
    return;
}

const QINGLONG_CONFIGS = CONFIG.QINGLONG_CONFIGS;
const SETTINGS = CONFIG.settings;
const JD_COOKIE_NAME = "JD_COOKIE";

let cookie = $request.headers.Cookie || $request.headers.cookie;

if (!cookie) {
    console.log("❌❌ 未获取到 Cookie");
    $done();
    return;
}

// 优化的Cookie提取方法
function extractJDCookie(cookie) {
    try {
        let pt_key_match = cookie.match(/pt_key=([^;]+);?/);
        let pt_pin_match = cookie.match(/pt_pin=([^;]+);?/);
        
        if (!pt_key_match || !pt_pin_match) {
            // 备用提取方法
            const key_index = cookie.indexOf('pt_key=');
            const pin_index = cookie.indexOf('pt_pin=');
            
            if (key_index !== -1 && pin_index !== -1) {
                const key_start = key_index + 7;
                const key_end = cookie.indexOf(';', key_start);
                pt_key_match = cookie.substring(key_start, key_end !== -1 ? key_end : cookie.length);
                
                const pin_start = pin_index + 7;
                const pin_end = cookie.indexOf(';', pin_start);
                pt_pin_match = cookie.substring(pin_start, pin_end !== -1 ? pin_end : cookie.length);
            }
        }
        
        return { 
            pt_key: Array.isArray(pt_key_match) ? pt_key_match[1] || pt_key_match[0] : pt_key_match,
            pt_pin: Array.isArray(pt_pin_match) ? pt_pin_match[1] || pt_pin_match[0] : pt_pin_match
        };
    } catch (error) {
        console.log(`❌❌ Cookie提取错误: ${error}`);
        return { pt_key: null, pt_pin: null };
    }
}

// 主处理逻辑
async function main() {
    if (!SETTINGS.auto_upload) {
        console.log("ℹ️ℹ️ 自动上传已禁用，跳过上传操作");
        return;
    }
    
    const { pt_key, pt_pin } = extractJDCookie(cookie);
    
    if (!pt_key || !pt_pin) {
        console.log("❌❌ 未获取到完整的pt_key或pt_pin");
        console.log(`原始Cookie: ${cookie.substring(0, 200)}...`);
        if (SETTINGS.notify_enabled) {
            sendNotification("京东Cookie获取失败", "Cookie不完整", "请重新登录京东APP");
        }
        return;
    }
    
    // 清理数据
    const clean_pt_pin = decodeURIComponent(pt_pin.replace(/;$/, ''));
    const jd_cookie = `pt_key=${pt_key};pt_pin=${clean_pt_pin};`;
    
    console.log('================完整Cookie获取成功================');
    console.log(`pt_pin: ${clean_pt_pin}`);
    console.log(`pt_key: ${pt_key.substring(0, 50)}...`);
    console.log(`Cookie长度: ${jd_cookie.length}`);
    console.log('==================================================');
    
    // 保存到本地
    if (SETTINGS.save_local) {
        saveLocalCookie(jd_cookie, clean_pt_pin);
    }
    
    // 发送详细通知
    if (SETTINGS.notify_enabled) {
        sendNotificationWithFullCK("京东Cookie获取成功", `账号: ${clean_pt_pin}`, jd_cookie);
    }
    
    // 上传到青龙面板
    await uploadToQingLong(jd_cookie, clean_pt_pin);
   // ============ 在这里添加 ============
    // 保存到BoxJS显示字段
    const currentTime = new Date().toLocaleString('zh-CN');
    $.setdata(jd_cookie, "@cookie.last_ck");
    $.setdata(currentTime, "@cookie.last_time");
    console.log("✅ Cookie已保存到BoxJS显示字段");
    // ============ 添加结束 ============
    }

// 修改主上传函数，增加变化检查逻辑
async function uploadToQingLong(cookie, pt_pin) {
    console.log(`开始上传Cookie到青龙面板: ${pt_pin}`);
    
    try {
        // 1. 查找可用的青龙容器
        const availableQL = await findAvailableQLInstance();
        if (!availableQL) {
            throw new Error("所有青龙容器都已达到最大CK数量限制");
        }
        
        // 2. 检查环境变量是否已存在
        const existingEnv = await findExistingEnv(availableQL, pt_pin);
        
        // 3. 执行上传操作
        if (existingEnv) {
            console.log(`🔍🔍 发现已存在的环境变量，检查CK变化...`);
            await updateQLEnv(availableQL, existingEnv, cookie, pt_pin);
        } else {
            console.log(`🆕🆕🆕 未找到现有环境变量，创建新的...`);
            await createQLEnv(availableQL, cookie, pt_pin);
        }
        
        console.log(`✅ Cookie同步完成: ${pt_pin}`);
        if (SETTINGS.notify_enabled) {
            sendNotification("青龙面板同步成功", `账号: ${pt_pin}`, "环境变量已处理");
        }
        
    } catch (error) {
        console.log(`❌❌ 上传到青龙失败: ${error.message}`);
        if (SETTINGS.notify_enabled) {
            sendNotification("青龙面板同步失败", `账号: ${pt_pin}`, error.message);
        }
    }
}

// 查找可用青龙容器 - 基于Python代码逻辑
async function findAvailableQLInstance() {
    for (const qlConfig of QINGLONG_CONFIGS) {
        try {
            const envCount = await getQLEnvCount(qlConfig);
            if (envCount < qlConfig.limit_count) {
                console.log(`✅ 找到可用青龙容器: ${qlConfig.address}, 当前CK数: ${envCount}/${qlConfig.limit_count}`);
                return qlConfig;
            } else {
                console.log(`⚠️ 青龙容器 ${qlConfig.address} 已达到最大CK数量限制`);
            }
        } catch (error) {
            console.log(`❌❌ 检查青龙容器 ${qlConfig.address} 失败: ${error.message}`);
            continue;
        }
    }
    return null;
}

// 获取青龙环境变量数量
async function getQLEnvCount(qlConfig) {
    const token = await getQLToken(qlConfig);
    const envs = await getQLEnvs(qlConfig, token);
    return envs.filter(env => env.name === JD_COOKIE_NAME).length;
}

// 修改查找现有环境变量函数，确保获取完整的环境变量信息
async function findExistingEnv(qlConfig, pt_pin) {
    const token = await getQLToken(qlConfig);
    const envs = await getQLEnvs(qlConfig, token);
    
    // 更精确的匹配逻辑，同时返回完整的环境变量信息（包括status和value）
    return envs.find(env => {
        if (env.name === JD_COOKIE_NAME && env.value) {
            // 从cookie值中提取pt_pin进行匹配
            const pinMatch = env.value.match(/pt_pin=([^;]+)/);
            if (pinMatch) {
                const envPin = decodeURIComponent(pinMatch[1]);
                return envPin === pt_pin;
            }
        }
        return false;
    });
}

// 修复后的创建环境变量函数
async function createQLEnv(qlConfig, cookie, pt_pin) {
    const token = await getQLToken(qlConfig);
    const url = `${qlConfig.address}/open/envs`;
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
    
    // 关键修改：使用数组格式，而不是对象格式
    const body = [{
        name: JD_COOKIE_NAME,
        value: cookie,
        remarks: `京东Cookie-${pt_pin}-${new Date().toLocaleDateString('zh-CN')}`
    }];
    
    console.log(`🆕🆕🆕 创建环境变量: ${pt_pin}`);
    
    const response = await $.http.post({ 
        url, 
        headers, 
        body: JSON.stringify(body),
        timeout: SETTINGS.timeout
    });
    
    console.log(`创建响应状态: ${response.statusCode}`);

    const responseData = JSON.parse(response.body);
    
    // 关键修改：检查响应代码是否为200
    if (response.statusCode === 200 && responseData.code === 200) {
        console.log(`✅ 环境变量创建成功！`);
        
        // 启用新创建的环境变量
        if (responseData.data && responseData.data.length > 0) {
            const newEnv = responseData.data[0];
            const newEnvId = newEnv.id || newEnv._id;
            
            if (newEnvId) {
                console.log(`🔄🔄 正在启用新环境变量 ID: ${newEnvId}`);
                const enableSuccess = await enableQLEnv(qlConfig, token, newEnvId);
                
                if (enableSuccess) {
                    console.log(`🎉🎉 环境变量已成功创建并启用！`);
                } else {
                    console.log(`⚠️ 创建成功但启用失败，请手动启用`);
                }
            }
        }
        
        return responseData;
    } else {
        // 更详细的错误信息
        const errorMsg = responseData.message || `HTTP ${response.statusCode}`;
        throw new Error(`创建失败: ${errorMsg}`);
    }
}

// 更新环境变量并启用 - 增加CK变化检查
async function updateQLEnv(qlConfig, existingEnv, cookie, pt_pin) {
    const token = await getQLToken(qlConfig);
    
    // 简单对比，避免重复提交相同的ck
    if (existingEnv.value === cookie) {
        console.log(`✅ Cookie一致，无需更新: ${pt_pin}`);
        if (SETTINGS.notify_enabled) {
            sendNotification(`✅ Cookie一致，无需更新: ${pt_pin}`);
        }
        
        // 即使CK未变化，也检查是否需要启用
        if (!isEnvEnabled(existingEnv)) {
            console.log(`🔄🔄 CK未变化但环境变量被禁用，正在启用: ${pt_pin}`);
            const envId = existingEnv.id || existingEnv._id;
            const enableSuccess = await enableQLEnv(qlConfig, token, envId);
            
            if (enableSuccess) {
                console.log(`✅ 环境变量启用成功: ${pt_pin}`);
                return { code: 200, message: "CK未变化，但已启用环境变量" };
            } else {
                console.log(`⚠️ 环境变量启用失败: ${pt_pin}`);
                return { code: 200, message: "CK未变化，启用失败" };
            }
        } else {
            console.log(`✅ CK未变化且环境变量已启用，无需操作: ${pt_pin}`);
            return { code: 200, message: "CK未变化，跳过更新" };
        }
    }
    
    const url = `${qlConfig.address}/open/envs`;
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
    
    // 确定环境变量的ID字段
    const envId = existingEnv.id || existingEnv._id;
    const body = {
        name: JD_COOKIE_NAME,
        value: cookie,
        remarks: `京东Cookie-${pt_pin}-${new Date().toLocaleDateString('zh-CN')}`,
        id: envId
    };

    console.log(`📝📝 检测到CK变化，更新环境变量: ${pt_pin}`);
    console.log(`原CK: ${existingEnv.value.substring(0, 80)}...`);
    console.log(`新CK: ${cookie.substring(0, 80)}...`);
    
    const response = await $.http.put({ 
        url, 
        headers, 
        body: JSON.stringify(body),
        timeout: SETTINGS.timeout 
    });

    if (response.statusCode !== 200) {
        const errorData = JSON.parse(response.body);
        throw new Error(`更新失败: ${errorData.message || response.statusCode}`);
    }

    // 更新成功后启用环境变量
    console.log(`✅ 更新成功，正在启用环境变量...`);
    const enableSuccess = await enableQLEnv(qlConfig, token, envId);
    
    if (!enableSuccess) {
        console.log(`⚠️ 环境变量更新成功，但启用操作未成功。请稍后在青龙面板手动启用。`);
    } else {
        console.log(`🎉🎉 环境变量已成功更新并启用！`);
    }

    return JSON.parse(response.body);
}

// 检查环境变量是否已启用
function isEnvEnabled(env) {
    // 青龙面板环境变量状态：0-启用，1-禁用
    return env.status === 0;
}

/**
 * 专用的启用环境变量函数
 * @param {Object} qlConfig - 青龙面板配置
 * @param {string} token - 认证令牌
 * @param {string|Array} envIds - 要启用的环境变量ID（单个ID或ID数组）
 * @returns {Promise<boolean>} 成功返回true，失败返回false
 */
async function enableQLEnv(qlConfig, token, envIds) {
    // 确保envIds是数组格式
    const idsArray = Array.isArray(envIds) ? envIds : [envIds];
    
    const url = `${qlConfig.address}/open/envs/enable`;
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
    
    try {
        console.log(`🔄🔄 正在启用环境变量，目标ID: ${idsArray.join(', ')}`);
        const response = await $.http.put({
            url: url,
            headers: headers,
            body: JSON.stringify(idsArray),
            timeout: SETTINGS.timeout
        });
        
        if (response.statusCode === 200) {
            const result = JSON.parse(response.body);
            if (result.code === 200) {
                console.log(`✅ 环境变量启用成功！`);
                return true;
            } else {
                console.log(`❌❌ 启用API返回错误: ${result.message}`);
                return false;
            }
        } else {
            console.log(`❌❌ 启用请求HTTP状态码异常: ${response.statusCode}`);
            return false;
        }
    } catch (error) {
        console.log(`❌❌ 调用启用API时发生异常: ${error.message}`);
        return false;
    }
}

// 获取青龙Token - 增强错误处理
async function getQLToken(qlConfig, retryCount = null) {
    const maxRetry = retryCount || SETTINGS.retry_count;
    for (let attempt = 1; attempt <= maxRetry; attempt++) {
        try {
            const url = `${qlConfig.address}/open/auth/token?client_id=${qlConfig.client_id}&client_secret=${qlConfig.client_secret}`;
            console.log(`获取Token尝试 ${attempt}/${maxRetry}: ${url.replace(qlConfig.client_secret, '***')}`);
            
            const response = await $.http.get({ 
                url,
                timeout: SETTINGS.timeout 
            });
            console.log(`Token响应状态: ${response.statusCode}`);
            
            if (response.statusCode === 200) {
                const data = JSON.parse(response.body);
                if (data.code === 200) {
                    console.log(`✅ Token获取成功`);
                    return data.data.token;
                } else {
                    throw new Error(`青龙API错误: ${data.message || '未知错误'}`);
                }
            } else {
                throw new Error(`HTTP错误: ${response.statusCode}`);
            }
        } catch (error) {
            console.log(`❌❌ Token获取失败 (尝试 ${attempt}): ${error.message}`);
            if (attempt === maxRetry) throw error;
            await sleep(2000); // 等待2秒后重试
        }
    }
}

// 获取环境变量列表
async function getQLEnvs(qlConfig, token) {
    const url = `${qlConfig.address}/open/envs?searchValue=${encodeURIComponent(JD_COOKIE_NAME)}`;
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
    
    const response = await $.http.get({ 
        url, 
        headers,
        timeout: SETTINGS.timeout 
    });
    
    if (response.statusCode === 200) {
        const data = JSON.parse(response.body);
        if (data.code === 200) {
            return data.data || [];
        }
    }
    throw new Error(`获取环境变量失败: ${response.statusCode}`);
}

// 工具函数
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function saveLocalCookie(cookie, pt_pin) {
    const timestamp = new Date().getTime();
    const cookie_data = {
        cookie: cookie,
        pt_pin: pt_pin,
        timestamp: timestamp,
        date: new Date().toLocaleString('zh-CN')
    };
    
    if (typeof $prefs !== 'undefined') {
        $prefs.setValueForKey(JSON.stringify(cookie_data), `jd_cookie_${pt_pin}`);
        console.log(`✅ Cookie已保存到Quantumult X: ${pt_pin}`);
    }
}

function sendNotificationWithFullCK(title, subtitle, fullCookie) {
    const maxLength = 100;
    let displayCookie = fullCookie;
    
    if (fullCookie.length > maxLength) {
        const firstPart = fullCookie.substring(0, 50);
        const lastPart = fullCookie.substring(fullCookie.length - 30);
        displayCookie = `${firstPart}...${lastPart}\n长度: ${fullCookie.length}字符`;
    }
    
    const message = `CK信息:\n${displayCookie}`;
    
    if (typeof $notify !== 'undefined') {
        $notify(title, subtitle, message);
    } else {
        console.log(`📢📢 ${title} - ${subtitle} - ${message}`);
    }
}

function sendNotification(title, subtitle, message) {
    if (typeof $notify !== 'undefined') {
        $notify(title, subtitle, message);
    } else {
        console.log(`📢📢 ${title} - ${subtitle} - ${message}`);
    }
}

// 执行主函数
main().then(() => {
    $done();
}).catch(error => {
    console.log(`❌❌ 脚本执行错误: ${error}`);
    $done();
});

// HTTP请求封装类
class HttpRequest {
    async get(options) {
        return await this.request('GET', options);
    }
    
    async post(options) {
        return await this.request('POST', options);
    }
    
    async put(options) {
        return await this.request('PUT', options);
    }
    
    async request(method, options) {
        return new Promise((resolve, reject) => {
            const requestOptions = {
                url: options.url,
                headers: options.headers || {},
                body: options.body
            };
            
            const httpMethod = method === 'GET' ? 'GET' : 
                             method === 'POST' ? 'POST' : 'PUT';
            
            if (httpMethod !== 'GET') {
                requestOptions.method = httpMethod;
            }
            
            $task.fetch(requestOptions).then(response => {
                resolve(response);
            }, reason => {
                reject(new Error(reason.error || '请求失败'));
            });
        });
    }
}

// 初始化HTTP实例
const http = new HttpRequest();
$.http = http;



// Env类实现（保持原有实现）
function Env(t, e) {
  "undefined" != typeof process && JSON.stringify(process.env).indexOf("GITHUB") > -1 && process.exit(0);

  class s {
    constructor(t) {
      this.env = t
    }

    send(t, e = "GET") {
      t = "string" == typeof t ? {url: t} : t;
      let s = this.get;
      return "POST" === e && (s = this.post), new Promise((e, i) => {
        s.call(this, t, (t, s, r) => {
          t ? i(t) : e(s)
        })
      })
    }

    get(t) {
      return this.send.call(this.env, t)
    }

    post(t) {
      return this.send.call(this.env, t, "POST")
    }
  }

  return new class {
    constructor(t, e) {
      this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`)
    }

    isNode() {
      return "undefined" != typeof module && !!module.exports
    }

    isQuanX() {
      return "undefined" != typeof $task
    }

    isSurge() {
      return "undefined" != typeof $httpClient && "undefined" == typeof $loon
    }

    isLoon() {
      return "undefined" != typeof $loon
    }

    toObj(t, e = null) {
      try {
        return JSON.parse(t)
      } catch {
        return e
      }
    }

    toStr(t, e = null) {
      try {
        return JSON.stringify(t)
      } catch {
        return e
      }
    }

    getjson(t, e) {
      let s = e;
      const i = this.getdata(t);
      if (i) try {
        s = JSON.parse(this.getdata(t))
      } catch {
      }
      return s
    }

    setjson(t, e) {
      try {
        return this.setdata(JSON.stringify(t), e)
      } catch {
        return !1
      }
    }

    getScript(t) {
      return new Promise(e => {
        this.get({url: t}, (t, s, i) => e(i))
      })
    }

    runScript(t, e) {
      return new Promise(s => {
        let i = this.getdata("@chavy_boxjs_userCfgs.httpapi");
        i = i ? i.replace(/\n/g, "").trim() : i;
        let r = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout");
        r = r ? 1 * r : 20, r = e && e.timeout ? e.timeout : r;
        const [o, h] = i.split("@"), n = {url: `http://${h}/v1/scripting/evaluate`, body: {script_text: t, mock_type: "cron", timeout: r}, headers: {"X-Key": o, Accept: "*/*"}};
        this.post(n, (t, e, i) => s(i))
      }).catch(t => this.logErr(t))
    }

    loaddata() {
      if (!this.isNode()) return {};
      {
        this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path");
        const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), i = !s && this.fs.existsSync(e);
        if (!s && !i) return {};
        {
          const i = s ? t : e;
          try {
            return JSON.parse(this.fs.readFileSync(i))
          } catch (t) {
            return {}
          }
        }
      }
    }

    writedata() {
      if (this.isNode()) {
        this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path");
        const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), i = !s && this.fs.existsSync(e), r = JSON.stringify(this.data);
        s ? this.fs.writeFileSync(t, r) : i ? this.fs.writeFileSync(e, r) : this.fs.writeFileSync(t, r)
      }
    }

    lodash_get(t, e, s) {
      const i = e.replace(/\[(\d+)\]/g, ".$1").split(".");
      let r = t;
      for (const t of i) if (r = Object(r)[t], void 0 === r) return s;
      return r
    }

    lodash_set(t, e, s) {
      return Object(t) !== t ? t : (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce((t, s, i) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[i + 1]) >> 0 == +e[i + 1] ? [] : {}, t)[e[e.length - 1]] = s, t)
    }

    getdata(t) {
      let e = this.getval(t);
      if (/^@/.test(t)) {
        const [, s, i] = /^@(.*?)\.(.*?)$/.exec(t), r = s ? this.getval(s) : "";
        if (r) try {
          const t = JSON.parse(r);
          e = t ? this.lodash_get(t, i, "") : e
        } catch (t) {
          e = ""
        }
      }
      return e
    }

    setdata(t, e) {
      let s = !1;
      if (/^@/.test(e)) {
        const [, i, r] = /^@(.*?)\.(.*?)$/.exec(e), o = this.getval(i), h = i ? "null" === o ? null : o || "{}" : "{}";
        try {
          const e = JSON.parse(h);
          this.lodash_set(e, r, t), s = this.setval(JSON.stringify(e), i)
        } catch (e) {
          const o = {};
          this.lodash_set(o, r, t), s = this.setval(JSON.stringify(o), i)
        }
      } else s = this.setval(t, e);
      return s
    }

    getval(t) {
      return this.isSurge() || this.isLoon() ? $persistentStore.read(t) : this.isQuanX() ? $prefs.valueForKey(t) : this.isNode() ? (this.data = this.loaddata(), this.data[t]) : this.data && this.data[t] || null
    }

    setval(t, e) {
      return this.isSurge() || this.isLoon() ? $persistentStore.write(t, e) : this.isQuanX() ? $prefs.setValueForKey(t, e) : this.isNode() ? (this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0) : this.data && this.data[e] || null
    }

    initGotEnv(t) {
      this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar))
    }

    get(t, e = (() => {
    })) {
      t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"]), this.isSurge() || this.isLoon() ? (this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, {"X-Surge-Skip-Scripting": !1})), $httpClient.get(t, (t, s, i) => {
        !t && s && (s.body = i, s.statusCode = s.status), e(t, s, i)
      })) : this.isQuanX() ? (this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, {hints: !1})), $task.fetch(t).then(t => {
        const {statusCode: s, statusCode: i, headers: r, body: o} = t;
        e(null, {status: s, statusCode: i, headers: r, body: o}, o)
      }, t => e(t))) : this.isNode() && (this.initGotEnv(t), this.got(t).on("redirect", (t, e) => {
        try {
          if (t.headers["set-cookie"]) {
            const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString();
            s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar
          }
        } catch (t) {
          this.logErr(t)
        }
      }).then(t => {
        const {statusCode: s, statusCode: i, headers: r, body: o} = t;
        e(null, {status: s, statusCode: i, headers: r, body: o}, o)
      }, t => {
        const {message: s, response: i} = t;
        e(s, i, i && i.body)
      }))
    }

    post(t, e = (() => {
    })) {
      if (t.body && t.headers && !t.headers["Content-Type"] && (t.headers["Content-Type"] = "application/x-www-form-urlencoded"), t.headers && delete t.headers["Content-Length"], this.isSurge() || this.isLoon()) this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, {"X-Surge-Skip-Scripting": !1})), $httpClient.post(t, (t, s, i) => {
        !t && s && (s.body = i, s.statusCode = s.status), e(t, s, i)
      }); else if (this.isQuanX()) t.method = "POST", this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, {hints: !1})), $task.fetch(t).then(t => {
        const {statusCode: s, statusCode: i, headers: r, body: o} = t;
        e(null, {status: s, statusCode: i, headers: r, body: o}, o)
      }, t => e(t)); else if (this.isNode()) {
        this.initGotEnv(t);
        const {url: s, ...i} = t;
        this.got.post(s, i).then(t => {
          const {statusCode: s, statusCode: i, headers: r, body: o} = t;
          e(null, {status: s, statusCode: i, headers: r, body: o}, o)
        }, t => {
          const {message: s, response: i} = t;
          e(s, i, i && i.body)
        })
      }
    }

    time(t, e = null) {
      const s = e ? new Date(e) : new Date;
      let i = {"M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds()};
      /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length)));
      for (let e in i) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? i[e] : ("00" + i[e]).substr(("" + i[e]).length)));
      return t
    }

    msg(e = t, s = "", i = "", r) {
      const o = t => {
        if (!t) return t;
        if ("string" == typeof t) return this.isLoon() ? t : this.isQuanX() ? {"open-url": t} : this.isSurge() ? {url: t} : void 0;
        if ("object" == typeof t) {
          if (this.isLoon()) {
            let e = t.openUrl || t.url || t["open-url"], s = t.mediaUrl || t["media-url"];
            return {openUrl: e, mediaUrl: s}
          }
          if (this.isQuanX()) {
            let e = t["open-url"] || t.url || t.openUrl, s = t["media-url"] || t.mediaUrl;
            return {"open-url": e, "media-url": s}
          }
          if (this.isSurge()) {
            let e = t.url || t.openUrl || t["open-url"];
            return {url: e}
          }
        }
      };
      if (this.isMute || (this.isSurge() || this.isLoon() ? $notification.post(e, s, i, o(r)) : this.isQuanX() && $notify(e, s, i, o(r))), !this.isMuteLog) {
        let t = ["", "==============📣系统通知📣=============="];
        t.push(e), s && t.push(s), i && t.push(i), console.log(t.join("\n")), this.logs = this.logs.concat(t)
      }
    }

    log(...t) {
      t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator))
    }

    logErr(t, e) {
      const s = !this.isSurge() && !this.isQuanX() && !this.isLoon();
      s ? this.log("", `❗️${this.name}, 错误!`, t.stack) : this.log("", `❗️${this.name}, 错误!`, t)
    }

    wait(t) {
      return new Promise(e => setTimeout(e, t))
    }

    done(t = {}) {
      const e = (new Date).getTime(), s = (e - this.startTime) / 1e3;
      this.log("", `🔔${this.name}, 结束! 🕛 ${s} 秒`), this.log(), (this.isSurge() || this.isQuanX() || this.isLoon()) && $done(t)
    }
  }(t, e)

}
