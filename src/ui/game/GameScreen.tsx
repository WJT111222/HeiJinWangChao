import { useMemo, useState } from 'react';
import type { GameState } from '../../domain/state';
import type { CompanionProfile } from '../../services/local/companionProfile';
import type { TurnDraft } from '../../domain/drafts';
import type { Settings } from '../settings/model';
import { Dialog, Detail, Empty } from '../Dialog';
import { Panels, panelNames } from '../panels/Panels';
import type { PanelName } from '../panels/Panels';
import { playerView, money, dateTime } from '../panels/playerView';

export function GameScreen({
  state,
  draft,
  companionProfile,
  settings,
  onSettings,
  onSaves,
}: {
  state: GameState;
  draft?: TurnDraft;
  companionProfile?: CompanionProfile;
  settings: Settings;
  onSettings: (settings: Settings) => void;
  onSaves: () => void;
}) {
  const [panel, setPanel] = useState<PanelName | '人物档案' | '经济与资产'>();
  const [input, setInput] = useState('');
  const view = useMemo(() => playerView(state, companionProfile), [state, companionProfile]);
  const hero = state.protagonist;
  const itemName = (id?: string) => (id ? state.items[id]?.name || '无' : '无');
  const equipment: [string, string][] = [
    ['上衣', itemName(hero.currentWear.topItemId)],
    ['下装', itemName(hero.currentWear.bottomItemId)],
    ['鞋子', itemName(hero.currentWear.shoesItemId)],
    ['饰品', hero.currentWear.accessoryItemIds.map(itemName).join('、') || '无'],
    ['主武器', itemName(hero.currentWear.primaryWeaponItemId)],
    ['副武器', itemName(hero.currentWear.secondaryWeaponItemId)],
    [
      '载具',
      hero.currentWear.currentVehicleAssetId
        ? state.economy.vehicles[hero.currentWear.currentVehicleAssetId]?.name || '无'
        : '无',
    ],
  ];
  const ownedAssets = [
    ...Object.values(state.economy.properties),
    ...Object.values(state.economy.vehicles),
    ...Object.values(state.economy.otherAssets),
  ].filter((asset) => asset.ownerRef.kind === 'protagonist' && asset.ownerRef.id === hero.id);
  const options = draft?.story?.actionOptions;
  return (
    <main className="game-layout">
      <aside className="hero-sidebar" aria-label="主角信息">
        <div className="sidebar-heading">
          <p className="eyebrow">YOUR LIFE</p>
          <span className="tag">第 {state.turnNumber} 回合</span>
        </div>
        <p className="game-clock">{dateTime(state.worldClock)}</p>
        <p className="location">⌖ {state.locations[hero.locationId]?.name || '地点未确认'}</p>
        <div className="weather">
          <span>{state.weatherText || '天气待确认'}</span>
          <p>{state.environmentText || '环境将由开局正文确立。'}</p>
        </div>
        <section>
          <div className="hero-identity">
            <span className="avatar large">{hero.name.slice(0, 1)}</span>
            <div>
              <h2>{hero.name}</h2>
              <p>
                {hero.age} 岁 · {hero.gender}
              </p>
              <p>{hero.profession}</p>
            </div>
          </div>
          <dl>
            <Detail label="身体">{hero.healthText || '待开局确认'}</Detail>
            <Detail label="情绪">{hero.emotionText || '待开局确认'}</Detail>
          </dl>
        </section>
        <section>
          <h3>流动资金</h3>
          <dl>
            <Detail label="现金">{money(state.economy.cash)}</Detail>
            <Detail label="线上资金">{money(state.economy.onlineBalance)}</Detail>
          </dl>
        </section>
        <section>
          <h3>当前穿戴与装备</h3>
          <dl>
            {equipment.map(([label, value]) => (
              <Detail key={label} label={label}>
                {value}
              </Detail>
            ))}
          </dl>
        </section>
        <div className="sidebar-actions">
          <button onClick={() => setPanel('人物档案')}>查看人物档案 ↗</button>
          <button onClick={() => setPanel('经济与资产')}>经济与资产 ↗</button>
          <button onClick={onSaves}>切换存档</button>
        </div>
      </aside>
      <section className="story-column" aria-label="剧情与行动">
        <div
          className={`reader ${!view.journal.length && !draft?.story ? 'reader-empty' : ''}`}
          data-testid="story-reader"
          tabIndex={0}
          aria-label="正文阅读区域"
        >
          <div className="reader-heading">
            <span className="eyebrow">THE STORY</span>
            <span className="tag">{state.journal.length ? '已保存正文' : '等待开局'}</span>
          </div>
          {view.journal.map((entry, index) => (
            <article className="story-entry" key={entry.turnId}>
              <p className="eyebrow">第 {index + 1} 回合</p>
              <p className="prose">{entry.narrative}</p>
            </article>
          ))}
          {draft?.story ? (
            <article className="story-entry">
              <span className="tag">正文草稿 · 世界状态尚未确认</span>
              <p className="prose">{draft.story.narrative}</p>
            </article>
          ) : (
            !view.journal.length && (
              <div className="opening-empty">
                <span className="opening-mark" aria-hidden="true">
                  序
                </span>
                <p className="eyebrow">A CITY. A TURNING POINT.</p>
                <h1>故事，尚未落笔。</h1>
                <p>
                  你的资料已保存。
                  <br />
                  这座城市中的第一幕，将在 AI 开局接入后生成。
                </p>
                <button disabled className="primary">
                  生成开局 · 后续阶段开放
                </button>
                <small>本阶段不会生成剧情或改变世界状态</small>
              </div>
            )
          )}
        </div>
        <div className="composer">
          <section className="workflow" aria-label="三阶段工作流">
            <div className="workflow-heading">
              <h3>三阶段工作流</h3>
              <small>AI 尚未接入</small>
            </div>
            <ol>
              {(['story', 'variables', 'world'] as const).map((stage, i) => {
                const status = draft?.stageStatus[stage];
                return (
                  <li key={stage}>
                    <span className="stage-number">0{i + 1}</span>
                    <strong>{['正文生成', '变量管理', '动态世界'][i]}</strong>
                    <small>
                      {status === 'skipped'
                        ? '用户跳过'
                        : status === 'failed'
                          ? '待后续恢复'
                          : status === 'ready' || status === 'preview'
                            ? '已保存 · 未提交'
                            : '后续开放'}
                    </small>
                  </li>
                );
              })}
            </ol>
            <details>
              <summary>重试与变更详情</summary>
              <p className="muted">
                尚无本阶段产生的请求或变量变更。阶段重试、变更校验及原子提交将在后续阶段接入。
              </p>
              <button disabled>重新加载失败阶段（后续开放）</button>
            </details>
          </section>
          <div className="runtime-switches">
            {(
              [
                ['useVariableStage', '变量管理'],
                ['useWorldStage', '动态世界'],
              ] as const
            ).map(([key, label]) => (
              <label className="toggle" key={key}>
                <input
                  type="checkbox"
                  checked={settings.runtime[key]}
                  onChange={(e) =>
                    onSettings({
                      ...settings,
                      runtime: { ...settings.runtime, [key]: e.target.checked },
                    })
                  }
                />
                {label}
              </label>
            ))}
            <small>仅保存后续尝试偏好</small>
          </div>
          {settings.prompts.actionOptions &&
            (options && options.length >= 3 && options.length <= 5 ? (
              <div className="action-options">
                {options.map((option) => (
                  <button key={option} onClick={() => setInput(option)}>
                    {option}
                  </button>
                ))}
              </div>
            ) : (
              <p className="field-hint">行动建议将在正文生成后显示。</p>
            ))}
          <label className="sr-only" htmlFor="player-input">
            你的行动
          </label>
          <textarea
            id="player-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={3}
            placeholder="写下你想做的事……（发送将在后续阶段开放）"
          />
          <div className="composer-footer">
            <span>开局与回合生成将在后续阶段开放</span>
            <div>
              <button disabled>重新 Roll</button>
              <button disabled>继续推演</button>
              <button className="primary" disabled>
                发送
              </button>
            </div>
          </div>
        </div>
      </section>
      <aside className="world-sidebar" aria-label="世界资料">
        <p className="eyebrow">WORLD ARCHIVE</p>
        <h2>世界资料</h2>
        <nav>
          {panelNames.map((name, index) => (
            <button key={name} onClick={() => setPanel(name)}>
              <span className="nav-number">0{index + 1}</span>
              <span>{name}</span>
              <span aria-hidden="true">↗</span>
            </button>
          ))}
        </nav>
        <div className="world-note">
          <span className="tiny-dot" />
          当前浏览器本地存档
          <p>
            从身边的人，到更远的城市。
            <br />
            已知的世界会在此留下记录。
          </p>
        </div>
      </aside>
      {panel && (
        <Dialog title={panel} onClose={() => setPanel(undefined)}>
          {panel === '人物档案' ? (
            <dl className="profile-details">
              {Object.entries({
                姓名: hero.name,
                年龄: hero.age,
                性别: hero.gender,
                职业: hero.profession,
                外貌: hero.appearance,
                性格: hero.personality,
                背景: hero.background,
                技能: hero.skills.join('、'),
                社会状态: hero.publicStatus || '未确认',
                法律状态: hero.legalStatus || '未确认',
              }).map(([label, value]) => (
                <Detail key={label} label={label}>
                  {value}
                </Detail>
              ))}
            </dl>
          ) : panel === '经济与资产' ? (
            <>
              <div className="metric-row">
                <span>现金 {money(state.economy.cash)}</span>
                <span>线上资金 {money(state.economy.onlineBalance)}</span>
              </div>
              <h3>收入</h3>
              {Object.values(state.economy.incomes).map((income) => (
                <article className="card entry" key={income.id}>
                  <h4>{income.source}</h4>
                  <p>
                    {money(income.amount)} ·{' '}
                    {income.status === 'received'
                      ? '已到账'
                      : income.status === 'expected'
                        ? '待确认收入'
                        : '已取消'}
                  </p>
                  <p>{income.scheduleText}</p>
                </article>
              ))}
              {!Object.keys(state.economy.incomes).length && <Empty>暂无收入记录</Empty>}
              <h3>债务</h3>
              {Object.values(state.economy.debts).map((debt) => (
                <article className="card entry" key={debt.id}>
                  <h4>{debt.creditor}</h4>
                  <p>
                    本金 {money(debt.principal)} · 未偿本金 {money(debt.outstanding)}
                  </p>
                  <p>{debt.repaymentTerms}</p>
                </article>
              ))}
              {!Object.keys(state.economy.debts).length && <Empty>暂无债务记录</Empty>}
              {(['property', 'vehicle', 'other'] as const).map((kind, i) => (
                <section key={kind}>
                  <h3>{['房产', '车辆', '其他资产'][i]}</h3>
                  {ownedAssets
                    .filter((a) => a.kind === kind)
                    .map((asset) => (
                      <article className="card entry" key={asset.id}>
                        <h4>{asset.name}</h4>
                        <p>
                          估值 {money(asset.estimatedValue)} · {asset.statusText}
                        </p>
                        <p>来源：{asset.source}</p>
                      </article>
                    ))}
                  {!ownedAssets.some((a) => a.kind === kind) && <Empty>暂无记录</Empty>}
                </section>
              ))}
            </>
          ) : (
            <Panels name={panel} view={view} />
          )}
        </Dialog>
      )}
    </main>
  );
}
