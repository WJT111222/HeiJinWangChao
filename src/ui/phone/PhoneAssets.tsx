import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { GameState } from '../../domain/state';
import { debtLabels, ownedAssets } from '../panels/economyView';
import { phoneDate, phoneMoney } from './phoneView';

function Card({ title, children }: { title: string; children: ReactNode[] }) {
  return (
    <section className="ph-card">
      <h4>{title}</h4>
      {children.length ? children : <small>暂无</small>}
    </section>
  );
}

export function PhoneAssets({
  state,
  soon,
  selected,
  select,
}: {
  state: GameState;
  soon: Set<string>;
  selected?: { id: string };
  select: (id: string) => void;
}) {
  const focusRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) {
      focusRow.current?.scrollIntoView({ block: 'nearest' });
      focusRow.current?.focus({ preventScroll: true });
    }
  }, [selected]);
  const economy = state.economy,
    assets = ownedAssets(state);
  const incoming = Object.values(economy.incomes).filter((item) => item.status === 'expected');
  return (
    <>
      <section className="ph-card">
        <h4>存款</h4>
        <strong className="ph-money">{phoneMoney(economy.onlineBalance)}</strong>
        <small>现金不在手机里显示</small>
      </section>
      <Card title="贷款">
        {Object.values(economy.debts).map((debt) => {
          const collateral = assets.filter((a) => debt.collateralAssetIds.includes(a.id)).map((a) => a.name);
          return (
            <div
              key={debt.id}
              ref={selected?.id === debt.id ? focusRow : undefined}
              tabIndex={-1}
              className="ph-row"
              data-highlighted={selected?.id === debt.id || undefined}
            >
              <span>
                <b>{debt.source || debt.creditor}</b>
                <small>
                  {debt.creditor} · {debtLabels[debt.status]}
                </small>
                <small>
                  {[
                    debt.repaymentTerms,
                    collateral.length ? '抵押：' + collateral.join('、') : '',
                    debt.autoPaymentAuthorized ? '自动扣款' : '未授权自动扣款',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </span>
              <span className="ph-value" data-due={soon.has(debt.id) || undefined}>
                {phoneMoney(debt.outstanding)}
                <small>{debt.dueAt ? phoneDate(debt.dueAt) + '到期' : '未约定期限'}</small>
              </span>
            </div>
          );
        })}
      </Card>
      <Card title="房产">
        {assets
          .filter((a) => a.kind === 'property')
          .map((a) => (
            <div className="ph-row" key={a.id}>
              <span>
                {a.name}
                <small>
                  {a.ownershipText} · {a.statusText}
                </small>
              </span>
              {a.mortgageDebtId && economy.debts[a.mortgageDebtId] ? (
                <button onClick={() => select(a.mortgageDebtId!)}>查看房贷 ›</button>
              ) : (
                <span className="ph-value">{phoneMoney(a.estimatedValue)}</span>
              )}
            </div>
          ))}
      </Card>
      <Card title="车辆">
        {assets
          .filter((a) => a.kind === 'vehicle')
          .map((a) => (
            <div className="ph-row" key={a.id}>
              <span>
                {a.name}
                <small>
                  {[a.model, a.plate, state.locations[a.locationId ?? '']?.name].filter(Boolean).join(' · ')}
                </small>
              </span>
              <span>{a.statusText}</span>
            </div>
          ))}
      </Card>
      <Card title="其他资产">
        {assets
          .filter((a) => a.kind === 'other')
          .map((a) => (
            <div className="ph-row" key={a.id}>
              <span>
                {a.name}
                <small>{a.details}</small>
              </span>
              <span className="ph-value">{phoneMoney(a.estimatedValue)}</span>
            </div>
          ))}
      </Card>
      <Card title="待收收入">
        {incoming.map((i) => (
          <div className="ph-row" key={i.id}>
            <span>
              {i.source}
              <small>{i.expectedAt ? '预计 ' + phoneDate(i.expectedAt) : i.scheduleText}</small>
            </span>
            <span className="ph-value">{phoneMoney(i.amount)}</span>
          </div>
        ))}
      </Card>
    </>
  );
}
