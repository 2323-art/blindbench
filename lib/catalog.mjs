export const FEE = 200000;
export const NETWORK = 'cardano:preprod';
export const agents = [
  { id: 'cedar', name: 'Agent Cedar', initials: 'Cd', score: 92, price: 2000000, status: 'Newcomer', metrics: [94, 92, 90], rank: 1 },
  { id: 'atlas', name: 'Agent Atlas', initials: 'At', score: 86, price: 3000000, status: 'Established', metrics: [88, 84, 86], rank: 2 },
  { id: 'finch', name: 'Agent Finch', initials: 'Fn', score: 78, price: 1000000, status: 'Newcomer', metrics: [80, 76, 78], rank: 3 },
];
export const birch = { id: 'birch', name: 'Agent Birch (new)', initials: 'Bi', score: 94, price: 1500000, status: 'Unranked newcomer', metrics: [96, 94, 92], rank: null };
export const tasks = [
  { id: 'launch', title: 'Product launch briefing', category: 'Business update', text: 'Northstar is launching its shared team inbox on 18 November. The pilot included 120 teams over six weeks. Median response time fell from 4 hours to 2.5 hours, while customer satisfaction stayed at 91%. The launch is limited to English-language accounts. French and German support is planned for February, subject to testing. Pricing starts at $24 per seat per month. The team must complete a security review before the launch can proceed.', outputs: {
    cedar: 'Northstar plans to launch its team inbox on 18 November, pending a security review. A six-week pilot with 120 teams reduced median response time from 4 to 2.5 hours; satisfaction held at 91%. English-only at launch, it starts at $24/seat/month. French and German are planned for February, subject to testing.',
    atlas: 'Northstar will launch a shared inbox on 18 November at $24 per seat per month. A pilot with 120 teams improved response times while satisfaction remained at 91%. French and German support will follow in February.',
    finch: 'Northstar is introducing a team inbox starting at $24 per seat per month. A pilot showed faster responses. The launch will initially support English.',
    birch: 'Pending security review, Northstar targets an English-only team inbox launch on 18 November at $24/seat/month. Its six-week, 120-team pilot cut median response time 37.5% (4h to 2.5h), with satisfaction unchanged at 91%. French and German may arrive in February after testing.' } },
  { id: 'research', title: 'Research digest', category: 'Study findings', text: 'Researchers compared a new reading app with standard homework in eight schools. The study enrolled 240 students for 10 weeks. Students using the app improved test scores by an average of 8 points, compared with 5 points in the comparison group. Assignment to groups was not random. Teachers volunteered their classes, and students with missing final tests were excluded. Researchers said the findings were promising but did not establish that the app caused the improvement. A larger randomized trial is planned next year.', outputs: {
    cedar: 'In a 10-week study of 240 students across eight schools, app users gained 8 test points versus 5 for standard homework. Nonrandom group assignment and exclusion of missing final tests limit the findings; causation is unproven. A larger randomized trial is planned next year.',
    atlas: 'A study of 240 students in eight schools found that a reading app improved scores by 8 points versus 5 for standard homework over 10 weeks. Researchers plan a larger trial next year.',
    finch: 'Students using a reading app improved their test scores more than a comparison group. Researchers plan further testing.',
    birch: 'A 240-student, eight-school study found 10-week gains of 8 points with a reading app and 5 with standard homework. Volunteer classes were not randomly assigned, and missing final tests were excluded, so the difference does not establish causation. A larger randomized trial is planned.' } },
  { id: 'meeting', title: 'Operations meeting notes', category: 'Decisions & actions', text: 'At Monday’s operations meeting, the team agreed to move the support portal to a new host on 12 December, provided the backup restore test passes. Maya will finish the test by 5 December. Omar will send customer notices by 8 December. A 30-minute maintenance window is planned at 02:00 UTC. The old portal will remain available in read-only mode for seven days. The proposal to increase subscription prices was deferred until January; no price change was approved.', outputs: {
    cedar: 'Support portal migration targets 12 December at 02:00 UTC with 30 minutes of maintenance, conditional on Maya’s backup restore test by 5 December. Omar sends notices by 8 December. The old portal stays read-only for seven days. Pricing discussion was deferred to January; no increase was approved.',
    atlas: 'The support portal moves on 12 December with a 30-minute maintenance window at 02:00 UTC. Maya handles backups and Omar notifies customers. The old portal will be read-only for seven days. Pricing will be reviewed in January.',
    finch: 'The team plans a December support portal migration. Maya handles testing, Omar handles communication, and pricing discussions will resume in January.',
    birch: 'Conditional on a successful restore test, migrate the support portal on 12 December, 02:00 UTC (30-minute window). Maya: test by 5 December. Omar: notices by 8 December. Keep the old portal read-only for seven days. No price rise approved; reconsider in January.' } },
];
export function parseBudget(value) {
  if (typeof value !== 'string' || !/^\d{1,3}(\.\d{1,6})?$/.test(value)) throw new Error('Enter a budget between 0 and 10 test ADA, with at most six decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const amount = Number(whole) * 1000000 + Number(fraction.padEnd(6, '0'));
  if (amount > 10000000) throw new Error('Demo budget limit is 10 test ADA.');
  return amount;
}
export function selectAgent(budget, direct = null, announced = false) {
  if (direct && (direct !== 'birch' || !announced)) throw new Error('Complete the Birch comparison before purchasing the unranked newcomer.');
  return (direct ? [birch] : agents).find(a => a.price + FEE <= budget) ?? null;
}
export function quote(input, announced, enrolled=false) {
  if (input.taskType && input.taskType !== 'summary') throw new Error('Only Summary is available in this demo.');
  const task = tasks.find(t => t.id === input.taskId);
  if (!task) throw new Error('Choose a preset summarisation task.');
  const budget = parseBudget(input.budget);
  let agent;
  if (input.agentId) {
    if (input.directAgent) throw new Error('Choose one agent.');
    agent = (enrolled?[birch,...agents]:agents).find(a => a.id === input.agentId);
    if (!agent) throw new Error('Choose a ranked summary agent.');
    if (agent.price + FEE > budget) throw new Error('This agent exceeds your service budget. No payment was made.');
  } else agent = input.directAgent ? selectAgent(budget,input.directAgent,announced||enrolled) : (enrolled?[birch,...agents]:agents).find(a=>a.price+FEE<=budget);
  if (!agent) throw new Error('No agent fits this budget. Increase it to at least 1.2 test ADA. No payment was made.');
  return { taskId: task.id, agentId: agent.id, budget, providerPrice: agent.price, fee: FEE, total: agent.price + FEE };
}
