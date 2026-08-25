import Link from 'next/link';
import { getSelectOptions } from '@/lib/queries';
import { RecordForm } from '@/components/RecordForm';
import { RowActions } from '@/components/RowActions';
import { RepairRulesButton } from '@/components/RepairRulesButton';
import { Badge, Empty, Explainer, Note, PageHeader, Panel, Td, Th } from '@/components/ui';
import { withOptions } from '@/lib/form-helpers';
import { getCategoryCatalog } from '@/lib/categories-queries';
import { getRuleHealth } from '@/lib/rules-queries';
import { category } from '@/lib/engine/categories';

const DIRECTION_LABEL: Record<string, string> = {
  any: 'Any amount',
  debit: 'Money out',
  credit: 'Money in',
};

export const dynamic = 'force-dynamic';

export default async function RulesPage() {
  const [rules, options, catalog] = await Promise.all([
    getRuleHealth(),
    getSelectOptions(),
    getCategoryCatalog(),
  ]);

  const fields = withOptions('payeeRule', {
    bankAccountId: options.accounts,
    categoryKey: catalog.map((c) => ({ value: c.key, label: c.label })),
  });

  const mendable = rules.filter((r) => r.repair !== null);
  const dead = rules.filter((r) => r.catches === 0);

  return (
    <>
      <PageHeader
        title="Payee rules"
        subtitle="A rule table learns the twenty-odd recurring payees each account sees, so after two months the monthly work is a handful of one-offs. Rules are also written automatically when you confirm a row in Review."
      />


      <Explainer title="Why this matters">
        A rule table is what stops this becoming the experience every other tool gives you: after two months of
        confirming, the monthly work is a handful of one-offs rather than a full page of guessing.
        <div className="mt-1.5">
          Matching is by substring, ignoring case and spacing, so a rule only works if its text survives into next
          month&apos;s statement. That is why a suggested rule is the vendor name alone and never the whole line — the
          dates, trace numbers and reference codes around it change every single time. The <strong>catches</strong>
          column is the check: a rule catching nothing does nothing, however right it looks.
        </div>
      </Explainer>
      {dead.length > 0 ? (
        <Note tone={mendable.length > 0 ? 'bad' : 'warn'}>
          {dead.length} rule{dead.length === 1 ? '' : 's'} match nothing on the statements imported so far. A rule
          matches by substring, so one whose text does not literally appear in a description can never fire — which
          looks exactly like a rule that works until the next import lands in Review untouched.
          {mendable.length > 0 ? (
            <>
              {' '}
              {mendable.length} of them can be mended from the lines {mendable.length === 1 ? 'it was' : 'they were'}{' '}
              meant to catch, by narrowing the text to the part that really is there.{' '}
              <span className="ml-1 inline-block align-middle">
                <RepairRulesButton label={`Repair ${mendable.length}`} />
              </span>
            </>
          ) : (
            ' None can be mended automatically — their words are nowhere on the imported statements, so edit them by hand.'
          )}
        </Note>
      ) : null}

      <Panel title="Add a rule">
        <RecordForm modelKey="payeeRule" fields={fields} />
      </Panel>

      <Panel
        title={`${rules.length} rules`}
        description="Catches counts the imported lines each rule's text appears in. A zero means the rule does nothing."
      >
        {rules.length === 0 ? (
          <Empty>Nothing yet. Rules accumulate as statements get categorized.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <Th>Account</Th>
                <Th>Description contains</Th>
                <Th>Category</Th>
                <Th>Applies to</Th>
                <Th right>Priority</Th>
                <Th right>Catches</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <Td>
                    <span className="text-[12px] text-muted">{rule.accountLabel}</span>
                  </Td>
                  <Td>
                    <code className="text-[12px]">{rule.match}</code>
                    {rule.repair ? (
                      <div className="mt-1 text-[11px] text-muted">
                        Never adjacent on any statement. Would become{' '}
                        <code className="text-bad">{rule.repair.match}</code>, catching {rule.repair.catches}.
                      </div>
                    ) : null}
                  </Td>
                  <Td>{category(rule.categoryKey, catalog)?.label ?? rule.categoryKey}</Td>
                  <Td>
                    <span className="text-[12px] text-muted">{DIRECTION_LABEL[rule.direction] ?? rule.direction}</span>
                  </Td>
                  <Td right>{rule.priority}</Td>
                  <Td right>
                    {rule.catches === 0 ? (
                      <Badge tone="bad">Matches nothing</Badge>
                    ) : (
                      <span className="num">{rule.catches}</span>
                    )}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-3">
                      {rule.repair ? <RepairRulesButton ruleId={rule.id} preview={rule.repair.match} /> : null}
                      <RowActions modelKey="payeeRule" id={rule.id} back="/settings/rules" />
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Note tone="muted">
        Matching is by substring and ignores case and spacing, so a rule only works if its text survives into next
        month&apos;s statement. That is why a suggested rule is the vendor name alone and never the whole line: the
        dates, trace numbers and reference codes around it change every time.
      </Note>
    </>
  );
}
