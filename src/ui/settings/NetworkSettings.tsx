import { useState } from 'react';
import { relayMode, setRelayMode } from '../../services/ai/corsRelay';
export function NetworkSettings({ openTiming }: { openTiming: () => void }) {
  const [mode, setMode] = useState(relayMode), [error, setError] = useState('');
  return <>
    <section className="ai-card" aria-label="网页版跨域自动中转"><h4>网页版跨域自动中转</h4>
      <label className="toggle"><input type="checkbox" checked={mode === 'auto'} onChange={event => {
        const next = event.target.checked ? 'auto' : 'off';
        try { setRelayMode(next); setMode(next); setError(''); } catch { setError('未能保存中转偏好，请检查本地存储权限。'); }
      }}/>启用跨域自动中转（推荐开启）</label>
      <p>部分第三方 API 不允许网页直接读取响应。普通兼容渠道优先直连；符合中转条件的直连网络错误可经本站服务器再试一次。已经收到 HTTP 响应后，不会因为断流而改走中转。小猫之神确认的传输只走本次选定的路径，不会在直连失败后自动重发。中转不保存密钥，但服务器在转发时会处理请求内容和密钥。个别情况下可能造成重复计费，可随时关闭。</p>
      {error && <p role="alert">{error}</p>}</section>
    <h4>安全说明</h4><p className="ai-sec">直连时密钥只发往你填写的服务；启用中转时，本站服务器也会处理密钥和请求内容。服务方和同一网站的脚本可能接触到密钥。浏览器存储不是安全的密钥库，在公共电脑上请关闭「记住密钥」。密钥不会进入游戏存档、提示词或诊断详情。请求开始时会冻结渠道、模型、参数和密钥，更改配置不影响正在执行的请求。</p>
    <h4>和自动重试的关系</h4><p>直连已经返回的失败可以按「失败自动重试」再试；真正走了本站中转仍失败的，不会自动再试。详见 <button className="ai-link" onClick={openTiming} aria-label="前往超时与重试">超时与重试</button>。</p>
  </>;
}
