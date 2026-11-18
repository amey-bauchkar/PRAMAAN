// Assessment and learning content for the demo (global banks, org_id NULL).
// Aptitude questions are generated from templates with computed answers; every answer is derived from
// the same numbers shown in the stem, so the key is correct by construction.

function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rnd = mulberry(77);

/** Puts the correct option at a deterministic position among distinct distractors. */
function mcq(correct, distractors) {
  const opts = [String(correct)];
  for (const d of distractors) { const s = String(d); if (!opts.includes(s) && opts.length < 4) opts.push(s); }
  let k = 1;
  while (opts.length < 4) { const s = String(typeof correct === 'number' ? correct + k * 7 : `${correct} (${k})`); if (!opts.includes(s)) opts.push(s); k++; }
  const pos = Math.floor(rnd() * 4);
  const [c] = opts.splice(0, 1);
  opts.splice(pos, 0, c);
  return { options: opts, answerIndex: pos };
}
const inr = n => `₹${n.toLocaleString('en-IN')}`;

export function aptitudeBank() {
  const qs = [];
  const add = (topic, subtopic, difficulty, stem, correct, distractors, explanation) => {
    const { options, answerIndex } = mcq(correct, distractors);
    qs.push({ topic, subtopic, difficulty, stem, options, answerIndex, explanation });
  };

  // Quantitative
  for (let i = 0; i < 6; i++) {
    const p = [5, 12, 15, 20, 25, 35][i], n = [480, 750, 1200, 640, 920, 1400][i], a = (p * n) / 100;
    add('quantitative', 'percentages', 1, `What is ${p}% of ${n}?`, a, [a + 12, a - 8, a * 2], `${p}/100 × ${n} = ${a}.`);
  }
  for (let i = 0; i < 6; i++) {
    const [x, y] = [[2, 3], [3, 5], [4, 5], [5, 7], [1, 4], [3, 7]][i], k = [400, 250, 300, 150, 900, 200][i], total = (x + y) * k;
    add('quantitative', 'ratios', 1, `${inr(total)} is divided between A and B in the ratio ${x}:${y}. What is B's share?`, inr(y * k), [inr(x * k), inr((y + 1) * k), inr(total / 2)], `B gets ${y}/${x + y} of ${inr(total)} = ${inr(y * k)}.`);
  }
  for (let i = 0; i < 6; i++) {
    const cp = [800, 1200, 2500, 640, 1500, 4000][i], p = [10, 15, 20, 25, 12, 5][i], sp = cp + (cp * p) / 100;
    add('quantitative', 'profit-loss', 2, `An item bought for ${inr(cp)} is sold at a ${p}% profit. What is the selling price?`, inr(sp), [inr(cp + p * 10), inr(sp + 50), inr(cp - (cp * p) / 100)], `SP = CP × (1 + ${p}/100) = ${inr(sp)}.`);
  }
  for (let i = 0; i < 6; i++) {
    const [a, b] = [[12, 24], [10, 15], [20, 30], [6, 12], [15, 30], [12, 36]][i], t = (a * b) / (a + b);
    add('quantitative', 'time-work', 2, `A can finish a job in ${a} days and B in ${b} days. Working together, how many days will they take?`, t, [t + 2, (a + b) / 2, t - 1], `Combined rate = 1/${a} + 1/${b}, so time = ${a}×${b}/(${a}+${b}) = ${t} days.`);
  }
  for (let i = 0; i < 6; i++) {
    const s = [60, 72, 45, 80, 54, 90][i], h = [3, 2.5, 4, 1.5, 5, 2][i], d = s * h;
    add('quantitative', 'speed-distance', 1, `A train travels ${d} km at ${s} km/h. How many hours does the journey take?`, h, [h + 1, h - 0.5, d / 100], `Time = distance ÷ speed = ${d}/${s} = ${h} h.`);
  }
  for (let i = 0; i < 6; i++) {
    const P = [5000, 12000, 8000, 20000, 15000, 6000][i], r = [8, 5, 10, 6, 4, 12][i], t = [3, 2, 4, 5, 3, 2][i], si = (P * r * t) / 100;
    add('quantitative', 'simple-interest', 2, `What is the simple interest on ${inr(P)} at ${r}% per year for ${t} years?`, inr(si), [inr(si + 200), inr((P * r) / 100), inr(si * 2)], `SI = P × R × T / 100 = ${inr(si)}.`);
  }
  for (let i = 0; i < 6; i++) {
    const nums = [[12, 15, 18, 21, 24], [40, 45, 50, 55, 60], [7, 9, 11, 13, 15], [100, 120, 140, 160, 180], [3, 6, 9, 12, 15], [25, 30, 35, 40, 45]][i];
    const avg = nums.reduce((x, y) => x + y, 0) / nums.length;
    add('quantitative', 'averages', 1, `What is the average of ${nums.join(', ')}?`, avg, [avg + 2, avg - 3, nums[4]], `Sum ${nums.reduce((x, y) => x + y, 0)} ÷ ${nums.length} = ${avg}.`);
  }

  // Logical
  for (let i = 0; i < 6; i++) {
    const kind = i % 3;
    let seq, next, why;
    if (kind === 0) { const a = 3 + i, d = 4 + i; seq = [0, 1, 2, 3, 4].map(k => a + k * d); next = a + 5 * d; why = `Each term adds ${d}.`; }
    else if (kind === 1) { const a = 2 + i, r = 2; seq = [0, 1, 2, 3, 4].map(k => a * r ** k); next = a * r ** 5; why = 'Each term doubles.'; }
    else { const o = i; seq = [1, 2, 3, 4, 5].map(k => (k + o) ** 2); next = (6 + o) ** 2; why = 'Consecutive squares.'; }
    add('logical', 'number-series', kind + 1, `What comes next: ${seq.join(', ')}, ?`, next, [next + 1, next - 2, seq[4] * 2], why);
  }
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; i < 6; i++) {
    const step = [2, 3, 2, 4, 3, 5][i], start = [0, 1, 3, 2, 4, 0][i];
    const seq = [0, 1, 2, 3].map(k => L[start + k * step]); const next = L[start + 4 * step];
    add('logical', 'letter-series', 1, `What comes next: ${seq.join(' ')} ?`, next, [L[start + 4 * step + 1], L[start + 4 * step - 1], L[start + 3 * step + 2]], `Each letter moves ${step} places forward.`);
  }
  const words = [['CAT', 'DOG'], ['SUN', 'MAP'], ['PEN', 'BOX'], ['RED', 'CUP'], ['HAT', 'JOB'], ['KEY', 'FAN']];
  for (let i = 0; i < 6; i++) {
    const k = [1, 2, 1, 3, 2, 1][i], shift = w => w.split('').map(c => L[(L.indexOf(c) + k) % 26]).join('');
    const [a, b] = words[i];
    add('logical', 'coding-decoding', 2, `If ${a} is written as ${shift(a)} in a code, how is ${b} written?`, shift(b), [b.split('').map(c => L[(L.indexOf(c) + k + 1) % 26]).join(''), b.split('').reverse().join(''), shift(b).split('').reverse().join('')], `Each letter is shifted ${k} place(s) forward.`);
  }
  const tri = [[3, 4, 5], [6, 8, 10], [5, 12, 13], [9, 12, 15], [8, 15, 17], [12, 16, 20]];
  for (let i = 0; i < 6; i++) {
    const [a, b, c] = tri[i];
    add('logical', 'direction-sense', 2, `Ravi walks ${a} km north, turns right and walks ${b} km. How far is he from the start, in a straight line?`, `${c} km`, [`${a + b} km`, `${b - a + 1} km`, `${c + 1} km`], `Right angle: √(${a}² + ${b}²) = ${c} km.`);
  }
  const oddSets = [[[2, 3, 5, 9], 9, '9 is not prime.'], [[4, 16, 36, 50], 50, '50 is not a perfect square.'], [[8, 27, 64, 81], 81, '81 is not a perfect cube.'], [[11, 13, 17, 21], 21, '21 is not prime.'], [[12, 18, 24, 31], 31, '31 is not a multiple of 6.'], [[25, 49, 81, 98], 98, '98 is not a perfect square.']];
  for (const [set, odd, why] of oddSets) {
    qs.push({ topic: 'logical', subtopic: 'odd-one-out', difficulty: 1, stem: `Which number does not belong: ${set.join(', ')}?`, options: set.map(String), answerIndex: set.indexOf(odd), explanation: why });
  }

  // Verbal
  const syn = [['Abundant', 'Plentiful'], ['Candid', 'Frank'], ['Diligent', 'Hardworking'], ['Lucid', 'Clear'], ['Meticulous', 'Careful'], ['Obsolete', 'Outdated']];
  syn.forEach(([w, s], i) => add('verbal', 'synonyms', 1, `Choose the word closest in meaning to "${w}".`, s, syn.filter((_, j) => j !== i).map(x => x[1]).slice(0, 3), `"${w}" means "${s.toLowerCase()}".`));
  const ant = [['Ancient', 'Modern'], ['Expand', 'Contract'], ['Generous', 'Stingy'], ['Rigid', 'Flexible'], ['Transparent', 'Opaque'], ['Permanent', 'Temporary']];
  ant.forEach(([w, a], i) => add('verbal', 'antonyms', 1, `Choose the word opposite in meaning to "${w}".`, a, ant.filter((_, j) => j !== i).map(x => x[1]).slice(0, 3), `The opposite of "${w}" is "${a.toLowerCase()}".`));
  const sc = [
    [['She don\'t like coffee.', 'She doesn\'t like coffee.', 'She not like coffee.', 'She doesn\'t likes coffee.'], 1, 'Third-person singular takes "doesn\'t" + base verb.'],
    [['Each of the students have a laptop.', 'Each of the students has a laptop.', 'Each of the student has a laptop.', 'Each of the students having a laptop.'], 1, '"Each" is singular, so "has".'],
    [['He is senior than me.', 'He is senior to me.', 'He is more senior than to me.', 'He is senior from me.'], 1, '"Senior" takes "to".'],
    [['I have been working here since five years.', 'I am working here for five years.', 'I have been working here for five years.', 'I working here since five years.'], 2, 'A duration takes "for" with the present perfect continuous.'],
    [['Neither the manager nor the clerks was present.', 'Neither the manager nor the clerks were present.', 'Neither the manager or the clerks were present.', 'Neither the manager nor the clerks is present.'], 1, 'With "neither…nor", the verb agrees with the nearer subject ("clerks").'],
    [['The news are good.', 'The news is good.', 'The news were good.', 'The newses are good.'], 1, '"News" is uncountable and singular.'],
  ];
  for (const [options, answerIndex, explanation] of sc) qs.push({ topic: 'verbal', subtopic: 'sentence-correction', difficulty: 2, stem: 'Which sentence is grammatically correct?', options, answerIndex, explanation });
  const prep = [['She is good ___ mathematics.', ['at', 'in', 'on', 'for'], 0], ['He insisted ___ paying the bill.', ['at', 'on', 'for', 'in'], 1], ['We arrived ___ the airport early.', ['to', 'in', 'at', 'on'], 2], ['She is fond ___ music.', ['with', 'for', 'about', 'of'], 3], ['He was accused ___ theft.', ['of', 'for', 'with', 'about'], 0], ['The train is ___ time today.', ['in', 'on', 'at', 'by'], 1]];
  for (const [stem, options, answerIndex] of prep) qs.push({ topic: 'verbal', subtopic: 'prepositions', difficulty: 1, stem: `Fill in the blank: ${stem}`, options, answerIndex, explanation: `Correct usage: "${stem.replace('___', options[answerIndex])}"` });

  return qs;
}

const SQL_SCHEMA = `CREATE TABLE departments (id INT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE employees (id INT PRIMARY KEY, name TEXT NOT NULL, dept_id INT REFERENCES departments(id), salary INT NOT NULL);`;

const SQL_DATA = {
  basic: `INSERT INTO departments VALUES (1,'Engineering'),(2,'Sales'),(3,'Support');
INSERT INTO employees VALUES (1,'Asha',1,90000),(2,'Ravi',1,72000),(3,'Meera',2,55000),(4,'Kiran',2,48000),(5,'Imran',3,40000);`,
  emptyDept: `INSERT INTO departments VALUES (1,'Engineering'),(2,'Sales'),(3,'Legal');
INSERT INTO employees VALUES (1,'Asha',1,90000),(2,'Ravi',2,60000);`,
  noDept: `INSERT INTO departments VALUES (1,'Engineering');
INSERT INTO employees VALUES (1,'Asha',1,90000),(2,'Tanvi',NULL,50000),(3,'Omkar',1,65000);`,
  ties: `INSERT INTO departments VALUES (1,'Engineering'),(2,'Sales');
INSERT INTO employees VALUES (1,'Asha',1,90000),(2,'Ravi',1,90000),(3,'Meera',2,70000),(4,'Kiran',2,70000),(5,'Yash',2,30000);`,
  single: `INSERT INTO departments VALUES (1,'Engineering');
INSERT INTO employees VALUES (1,'Asha',1,90000);`,
};

export function codingProblems() {
  return [
    {
      slug: 'two-sum', title: 'Pair With Target Sum', language: 'javascript', entry: 'twoSum', marks: 10, difficulty: 1,
      topics: ['arrays', 'hashing'], skills: ['problem-solving', 'data-structures', 'javascript'],
      statement: 'Return the indices [i, j] (i < j) of the first pair of numbers in `nums` that add up to `target`, scanning j from left to right. Return [] if there is none.',
      starter: 'function twoSum(nums, target) {\n  // your code\n}\n',
      reference: 'function twoSum(nums, target) { const seen = new Map(); for (let j = 0; j < nums.length; j++) { const need = target - nums[j]; if (seen.has(need)) return [seen.get(need), j]; if (!seen.has(nums[j])) seen.set(nums[j], j); } return []; }',
      publicTests: [{ input: [[2, 7, 11, 15], 9], description: 'example' }],
      hiddenTests: [
        { input: [[3, 2, 4], 6], description: 'pair not at the start' },
        { input: [[], 5], description: 'empty array' },
        { input: [[3, 3], 6], description: 'duplicate values' },
        { input: [[1, 2, 3], 100], description: 'no pair exists' },
        { input: [[-1, -2, -3, -4], -6], description: 'negative numbers' },
      ],
    },
    {
      slug: 'balanced-brackets', title: 'Balanced Brackets', language: 'javascript', entry: 'isBalanced', marks: 10, difficulty: 2,
      topics: ['stacks', 'strings'], skills: ['problem-solving', 'data-structures', 'javascript'],
      statement: 'Return true if every bracket in `s` — (), [] and {} — is closed in the right order. Other characters are ignored.',
      starter: 'function isBalanced(s) {\n  // your code\n}\n',
      reference: "function isBalanced(s) { const st = []; const pair = { ')': '(', ']': '[', '}': '{' }; for (const c of s) { if ('([{'.includes(c)) st.push(c); else if (c in pair) { if (st.pop() !== pair[c]) return false; } } return st.length === 0; }",
      publicTests: [{ input: ['([]){}'], description: 'example' }],
      hiddenTests: [
        { input: [''], description: 'empty string' },
        { input: ['(]'], description: 'wrong closing type' },
        { input: ['(('], description: 'unclosed bracket' },
        { input: ['a(b[c]d)e'], description: 'other characters ignored' },
        { input: ['())('], description: 'close before open' },
      ],
    },
    {
      slug: 'second-largest', title: 'Second Largest Distinct', language: 'javascript', entry: 'secondLargest', marks: 10, difficulty: 1,
      topics: ['arrays'], skills: ['problem-solving', 'javascript'],
      statement: 'Return the second largest distinct value in `nums`, or null if it does not exist.',
      starter: 'function secondLargest(nums) {\n  // your code\n}\n',
      reference: 'function secondLargest(nums) { const s = [...new Set(nums)].sort((a, b) => b - a); return s.length > 1 ? s[1] : null; }',
      publicTests: [{ input: [[4, 9, 2, 7]], description: 'example' }],
      hiddenTests: [
        { input: [[5, 5, 5]], description: 'all equal' },
        { input: [[1]], description: 'single element' },
        { input: [[9, 9, 8]], description: 'duplicate maximum' },
        { input: [[-3, -1, -2]], description: 'negative numbers' },
      ],
    },
    {
      slug: 'merge-intervals', title: 'Merge Booking Intervals', language: 'javascript', entry: 'mergeIntervals', marks: 10, difficulty: 2,
      topics: ['sorting', 'arrays'], skills: ['problem-solving', 'algorithms', 'javascript'],
      statement: 'Given [start, end] intervals in any order, merge all overlapping or touching intervals and return them sorted by start.',
      starter: 'function mergeIntervals(intervals) {\n  // your code\n}\n',
      reference: 'function mergeIntervals(iv) { const s = iv.map(x => [...x]).sort((a, b) => a[0] - b[0]); const out = []; for (const x of s) { const last = out[out.length - 1]; if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]); else out.push(x); } return out; }',
      publicTests: [{ input: [[[1, 3], [2, 6], [8, 10]]], description: 'example' }],
      hiddenTests: [
        { input: [[]], description: 'no intervals' },
        { input: [[[5, 7], [1, 2]]], description: 'unsorted input' },
        { input: [[[1, 4], [4, 5]]], description: 'touching intervals' },
        { input: [[[1, 10], [2, 3], [4, 5]]], description: 'nested intervals' },
      ],
    },
    {
      slug: 'dept-headcount', title: 'Headcount per Department', language: 'sql', entry: 'query', marks: 10, difficulty: 2,
      topics: ['sql', 'joins', 'aggregation'], skills: ['sql', 'dbms'],
      statement: 'Return every department name with its number of employees as `headcount`, including departments with no employees. Order by headcount descending, then name.',
      starter: '-- employees(id, name, dept_id, salary), departments(id, name)\nSELECT ...',
      reference: 'SELECT d.name, COUNT(e.id)::int AS headcount FROM departments d LEFT JOIN employees e ON e.dept_id = d.id GROUP BY d.name ORDER BY headcount DESC, d.name',
      publicTests: [{ setup: SQL_DATA.basic, description: 'example data' }],
      hiddenTests: [
        { setup: SQL_DATA.emptyDept, description: 'department with no employees' },
        { setup: SQL_DATA.noDept, description: 'employee without a department' },
        { setup: SQL_DATA.ties, description: 'tied headcounts ordered by name' },
      ],
    },
    {
      slug: 'second-highest-salary', title: 'Second Highest Salary', language: 'sql', entry: 'query', marks: 10, difficulty: 2,
      topics: ['sql', 'subqueries'], skills: ['sql'],
      statement: 'Return one row with column `second_highest`: the second highest distinct salary, or NULL if there is none.',
      starter: 'SELECT ... AS second_highest',
      reference: 'SELECT (SELECT DISTINCT salary FROM employees ORDER BY salary DESC OFFSET 1 LIMIT 1) AS second_highest',
      publicTests: [{ setup: SQL_DATA.basic, description: 'example data' }],
      hiddenTests: [
        { setup: SQL_DATA.ties, description: 'tied top salaries' },
        { setup: SQL_DATA.single, description: 'only one employee' },
        { setup: SQL_DATA.noDept, description: 'mixed departments' },
      ],
    },
    {
      slug: 'employee-departments', title: 'Employees and Their Departments', language: 'sql', entry: 'query', marks: 10, difficulty: 1,
      topics: ['sql', 'joins'], skills: ['sql'],
      statement: 'Return `name` and `department` for every employee, with department NULL when they have none. Order by name.',
      starter: 'SELECT ...',
      reference: 'SELECT e.name, d.name AS department FROM employees e LEFT JOIN departments d ON d.id = e.dept_id ORDER BY e.name',
      publicTests: [{ setup: SQL_DATA.basic, description: 'example data' }],
      hiddenTests: [
        { setup: SQL_DATA.noDept, description: 'employee without a department' },
        { setup: SQL_DATA.single, description: 'single employee' },
      ],
    },
    {
      slug: 'high-paying-departments', title: 'High-Paying Departments', language: 'sql', entry: 'query', marks: 10, difficulty: 3,
      topics: ['sql', 'aggregation', 'having'], skills: ['sql', 'dbms'],
      statement: 'Return `name` and `avg_salary` (rounded to a whole number) for departments whose average salary is above 50000. Order by avg_salary descending.',
      starter: 'SELECT ...',
      reference: 'SELECT d.name, ROUND(AVG(e.salary))::int AS avg_salary FROM departments d JOIN employees e ON e.dept_id = d.id GROUP BY d.name HAVING AVG(e.salary) > 50000 ORDER BY avg_salary DESC',
      publicTests: [{ setup: SQL_DATA.basic, description: 'example data' }],
      hiddenTests: [
        { setup: SQL_DATA.ties, description: 'average exactly above and below the line' },
        { setup: SQL_DATA.emptyDept, description: 'department with no employees' },
      ],
    },
  ].map(p => ({ ...p, sqlSchema: p.language === 'sql' ? SQL_SCHEMA : null }));
}

// [slug, skill slug, title, kind, problem slug | null, target proof, est hours, weak topics, description]
export const LEARNING_TASKS = [
  ['sql-joins-practice', 'sql', 'SQL practice set 1: joins', 'coding', 'employee-departments', 'L2', 1.5, ['sql', 'joins', 'databases'], 'LEFT and INNER joins on an employees/departments schema. Passing the hidden tests counts as Assessed proof for SQL.'],
  ['sql-aggregation-practice', 'sql', 'SQL practice set 2: GROUP BY and HAVING', 'coding', 'high-paying-departments', 'L2', 2, ['sql', 'aggregation', 'databases'], 'Aggregations with HAVING and correct handling of empty groups.'],
  ['sql-mini-project', 'sql', 'Mini-project: library database', 'mentor_review', null, 'L3', 6, ['sql', 'databases'], 'Design a 4-table library schema with constraints, load sample data and write 5 report queries. Push it to a repository and submit the link for mentor review.'],
  ['arrays-hashing-drill', 'data-structures', 'Arrays and hashing drill', 'coding', 'two-sum', 'L2', 1, ['arrays', 'hashing', 'problem-solving'], 'Classic hash-map lookup problem with edge cases.'],
  ['stack-drill', 'data-structures', 'Stacks drill', 'coding', 'balanced-brackets', 'L2', 1, ['stacks', 'strings'], 'Bracket matching with a stack.'],
  ['sorting-drill', 'algorithms', 'Sorting and intervals drill', 'coding', 'merge-intervals', 'L2', 1.5, ['sorting', 'arrays'], 'Sort-then-sweep pattern.'],
  ['js-arrays-drill', 'javascript', 'JavaScript arrays drill', 'coding', 'second-largest', 'L2', 1, ['arrays', 'problem-solving'], 'Sets, sorting and edge cases in JavaScript.'],
  ['docker-containerise', 'docker', 'Containerise your project', 'project', null, 'L1', 3, ['docker'], 'Add a Dockerfile and compose file to one of your repositories so it runs with one command, then re-import the repository.'],
  ['git-workflow', 'git', 'Branch, review and merge', 'project', null, 'L1', 2, ['git'], 'Work on a feature branch, open a pull request with a description, and merge it. Re-import the repository.'],
  ['python-cli-tool', 'python', 'Python CLI tool with tests', 'project', null, 'L1', 4, ['python'], 'Build a small command-line tool with argument parsing and pytest tests in a repository, then re-import it.'],
  ['react-component', 'react', 'Accessible React form', 'project', null, 'L1', 4, ['react'], 'Build a form with validation and labelled fields in a repository and re-import it.'],
  ['ml-baseline', 'machine-learning', 'Baseline model with evaluation', 'project', null, 'L1', 6, ['machine-learning'], 'Train a baseline classifier on a public dataset with a train/test split and report precision and recall.'],
  ['linux-shell-practice', 'linux', 'Linux shell practice', 'mentor_review', null, 'L3', 2, ['linux'], 'Complete the lab sheet on permissions, processes and pipes; your mentor reviews it in the lab.'],
  ['embedded-uart-lab', 'embedded-c', 'UART driver lab', 'mentor_review', null, 'L3', 4, ['embedded-c', 'microcontrollers'], 'Write a polled UART driver for the lab board and demonstrate echo; mentor signs off against the rubric.'],
  ['microcontroller-timer-lab', 'microcontrollers', 'Timer interrupt lab', 'mentor_review', null, 'L3', 3, ['microcontrollers'], 'Blink an LED at 1 Hz using a timer interrupt, not a delay loop.'],
  ['solidworks-assembly', 'solidworks', 'Gearbox assembly model', 'mentor_review', null, 'L3', 6, ['solidworks', 'gdt'], 'Model a two-stage gearbox assembly with drawings and GD&T callouts; mentor reviews the files.'],
  ['autocad-floor-plan', 'autocad', 'Residential floor plan', 'mentor_review', null, 'L3', 5, ['autocad'], 'Draft a 2BHK floor plan with dimensions, layers and a title block.'],
  ['estimation-exercise', 'estimation-costing', 'Quantity estimate for a boundary wall', 'mentor_review', null, 'L3', 4, ['estimation-costing'], 'Prepare a bill of quantities and cost estimate for a 30 m boundary wall.'],
  ['solar-sizing', 'solar-pv', 'Rooftop solar sizing', 'mentor_review', null, 'L3', 3, ['solar-pv'], 'Size a 3 kW rooftop system: panels, inverter, cabling and earthing, with a single-line diagram.'],
  ['electrical-load-calc', 'electrical-design', 'Building load calculation', 'mentor_review', null, 'L3', 3, ['electrical-design'], 'Calculate the connected and demand load for a small office and choose cable sizes.'],
  ['quant-practice', 'quant-aptitude', 'Quantitative aptitude practice', 'mentor_review', null, 'L2', 2, ['percentages', 'ratios', 'time-work', 'speed-distance', 'profit-loss', 'simple-interest', 'averages'], 'Timed practice on your weak quantitative topics; retake the mock drive aptitude round to prove it.'],
  ['logical-practice', 'logical-reasoning', 'Logical reasoning practice', 'mentor_review', null, 'L2', 2, ['number-series', 'letter-series', 'coding-decoding', 'direction-sense', 'odd-one-out'], 'Timed practice on series, coding-decoding and directions; retake the aptitude round to prove it.'],
  ['verbal-practice', 'verbal-ability', 'Verbal ability practice', 'mentor_review', null, 'L2', 2, ['synonyms', 'antonyms', 'sentence-correction', 'prepositions'], 'Grammar and vocabulary practice; retake the aptitude round to prove it.'],
];

// Interview questions per role: [role, topic, question, [[point, [keywords]]...]]
export const INTERVIEW_QUESTIONS = [
  ['Backend Developer', 'databases', 'What is a database index, and when can adding one make things worse?', [['Explains an index speeds up lookups', ['faster lookup', 'speed up', 'speeds up', 'faster search', 'b-tree', 'b tree']], ['Mentions extra cost on writes', ['slower insert', 'slows down writes', 'write overhead', 'slower writes', 'insert', 'update cost']], ['Mentions storage cost', ['storage', 'disk space', 'memory']]]],
  ['Backend Developer', 'joins', 'Explain the difference between an INNER JOIN and a LEFT JOIN with an example.', [['INNER returns only matching rows', ['only matching', 'both tables', 'matching rows']], ['LEFT keeps all rows from the left table', ['all rows from the left', 'all the rows of the left', 'left table', 'even if no match']], ['Unmatched columns become NULL', ['null']]]],
  ['Backend Developer', 'apis', 'How would you design a REST endpoint to create an order, and what status codes would you return?', [['Uses POST on a collection', ['post']], ['Returns 201 with the created resource', ['201', 'created']], ['Handles validation errors with 400/422', ['400', '422', 'bad request', 'validation']], ['Considers idempotency or duplicates', ['idempot', 'duplicate', 'retry']]]],
  ['Backend Developer', 'problem-solving', 'How would you find duplicate emails in a list of one million users efficiently?', [['Uses a hash set or map', ['hash', 'set', 'map', 'dictionary']], ['Mentions linear time', ['o(n)', 'linear', 'single pass']], ['Normalises case or whitespace', ['lowercase', 'lower case', 'trim', 'normalis', 'normaliz']]]],
  ['Data Analyst', 'sql', 'How would you find the top three products by revenue for each month?', [['Groups by month and product', ['group by']], ['Uses a window function or ranking', ['row_number', 'rank', 'dense_rank', 'window']], ['Filters to rank ≤ 3', ['<= 3', '≤ 3', 'top 3', 'top three', 'limit']]]],
  ['Data Analyst', 'statistics', 'What is the difference between mean and median, and when would you report the median?', [['Defines mean as average', ['average', 'sum divided']], ['Defines median as middle value', ['middle']], ['Median for skewed data or outliers', ['skew', 'outlier']]]],
  ['Data Analyst', 'data-visualisation', 'Which chart would you use to compare monthly sales across five regions, and why?', [['Bar or line chart', ['bar', 'line']], ['Avoids pie for comparison', ['not a pie', 'avoid pie', 'pie charts are hard']], ['Mentions clear labels or one axis', ['label', 'axis', 'legend']]]],
  ['Software Engineer Trainee', 'oop', 'Explain encapsulation and polymorphism with a small example.', [['Encapsulation hides internal state', ['hide', 'private', 'internal state', 'access modifier']], ['Polymorphism: same interface, different behaviour', ['override', 'same method', 'different behaviour', 'different behavior', 'interface']], ['Gives an example', ['example', 'class', 'shape', 'animal']]]],
  ['Software Engineer Trainee', 'data-structures', 'When would you use a hash map instead of an array?', [['Fast lookup by key', ['key', 'lookup', 'o(1)', 'constant time']], ['Arrays for ordered or index access', ['index', 'order']], ['Mentions memory or collisions trade-off', ['memory', 'collision']]]],
  ['Software Engineer Trainee', 'problem-solving', 'How do you debug a function that returns the wrong answer only for some inputs?', [['Reproduces with a failing input', ['reproduce', 'failing input', 'test case']], ['Narrows down with logs or a debugger', ['log', 'debugger', 'breakpoint', 'print']], ['Checks edge cases', ['edge case', 'empty', 'boundary']]]],
  ['Cloud Support Engineer', 'linux', 'A web server on Linux is not responding. What do you check first?', [['Checks the process or service status', ['systemctl', 'service', 'process', 'ps ']], ['Checks logs', ['log', 'journalctl']], ['Checks ports or network', ['port', 'netstat', 'ss ', 'firewall', 'curl']]]],
  ['Cloud Support Engineer', 'docker', 'What is the difference between a Docker image and a container?', [['Image is a template', ['template', 'blueprint', 'read-only']], ['Container is a running instance', ['running instance', 'instance']], ['Mentions layers or Dockerfile', ['layer', 'dockerfile']]]],
  ['Cloud Support Engineer', 'networking', 'What happens when you type a URL into a browser?', [['DNS resolution', ['dns']], ['TCP/TLS connection', ['tcp', 'tls', 'handshake']], ['HTTP request and response', ['http', 'request', 'response']]]],
  ['ML Engineer Intern', 'machine-learning', 'How do you detect and reduce overfitting?', [['Compares train vs validation performance', ['validation', 'test set', 'train']], ['Regularisation or simpler model', ['regulari', 'dropout', 'simpler model']], ['More data or augmentation', ['more data', 'augment']]]],
  ['ML Engineer Intern', 'statistics', 'When is accuracy a misleading metric?', [['Imbalanced classes', ['imbalance', 'imbalanced']], ['Precision/recall/F1', ['precision', 'recall', 'f1']], ['Gives an example', ['fraud', 'disease', 'rare']]]],
  ['ML Engineer Intern', 'python', 'How would you load a CSV, handle missing values and split it for training in Python?', [['Uses pandas', ['pandas', 'read_csv']], ['Handles missing values', ['fillna', 'dropna', 'impute', 'missing']], ['Train/test split', ['train_test_split', 'split']]]],
  ['Embedded Systems Engineer', 'microcontrollers', 'Why use a timer interrupt instead of a delay loop?', [['CPU is free during the wait', ['free', 'other tasks', 'blocking']], ['Accurate timing', ['accurate', 'precise']], ['Lower power', ['power', 'sleep']]]],
  ['Embedded Systems Engineer', 'embedded-c', 'What does the volatile keyword do in C, and when is it needed?', [['Prevents compiler optimising away reads', ['optimi', 'compiler']], ['Used for hardware registers', ['register', 'hardware']], ['Used for variables changed in an ISR', ['interrupt', 'isr']]]],
  ['Embedded Systems Engineer', 'digital-electronics', 'Explain the difference between a latch and a flip-flop.', [['Latch is level-triggered', ['level']], ['Flip-flop is edge-triggered', ['edge']], ['Flip-flops used in synchronous design', ['clock', 'synchronous']]]],
  ['Design Engineer (GET)', 'gdt', 'What is the purpose of GD&T on a drawing?', [['Specifies form and position tolerances', ['tolerance', 'form', 'position']], ['Communicates design intent', ['intent', 'function']], ['Datums', ['datum']]]],
  ['Design Engineer (GET)', 'manufacturing-processes', 'How would you choose between casting and machining for a part?', [['Considers volume', ['volume', 'quantity', 'batch']], ['Considers tolerance and finish', ['tolerance', 'finish', 'accuracy']], ['Considers cost and material', ['cost', 'material']]]],
  ['Design Engineer (GET)', 'solidworks', 'How do you keep a SolidWorks model easy to change later?', [['Uses design intent and constraints', ['intent', 'constraint', 'relation']], ['Uses equations or global variables', ['equation', 'variable', 'parameter']], ['Clean feature tree', ['feature tree', 'naming', 'order of features']]]],
  ['Junior Site Engineer', 'estimation-costing', 'How do you estimate the quantity of concrete for a slab?', [['Length × width × thickness', ['length', 'width', 'thickness', 'volume']], ['Adds wastage', ['wastage', 'waste']], ['Converts to bags or materials', ['bag', 'cement', 'mix ratio', 'ratio']]]],
  ['Junior Site Engineer', 'surveying', 'What checks do you do before setting out a building on site?', [['Checks reference points / benchmark', ['benchmark', 'reference', 'control point']], ['Checks diagonals or right angles', ['diagonal', 'right angle', '3-4-5']], ['Checks levels', ['level']]]],
  ['Junior Site Engineer', 'autocad', 'How do you organise a drawing in AutoCAD so others can use it?', [['Uses layers', ['layer']], ['Consistent dimension and text styles', ['dimension style', 'text style', 'style']], ['Title block and scale', ['title block', 'scale']]]],
  ['Solar Installation Technician', 'solar-pv', 'How do you decide the number of panels for a 3 kW rooftop system?', [['Divides system size by panel wattage', ['wattage', 'watt', '3000']], ['Considers roof area and shading', ['shade', 'shading', 'roof area']], ['Considers inverter limits', ['inverter']]]],
  ['Solar Installation Technician', 'electrical-design', 'Why is earthing important in a solar installation?', [['Safety from shock', ['shock', 'safety']], ['Protects from lightning or faults', ['lightning', 'fault', 'surge']], ['Mentions earth resistance or pit', ['resistance', 'earth pit', 'electrode']]]],
  ['Solar Installation Technician', 'electrical-machines', 'What safety steps do you follow before working on an inverter?', [['Isolates AC and DC', ['isolate', 'switch off', 'disconnect']], ['Verifies zero voltage', ['multimeter', 'zero voltage', 'test']], ['PPE', ['ppe', 'gloves', 'insulated']]]],
];

// Role → [technical problem slugs (2 are sampled), machine-test skill slugs]
export const MOCK_ROLES = {
  'Backend Developer': { problems: ['two-sum', 'dept-headcount', 'second-highest-salary', 'balanced-brackets'], mix: ['javascript', 'sql'] },
  'Data Analyst': { problems: ['dept-headcount', 'high-paying-departments', 'employee-departments', 'second-largest'], mix: ['sql', 'sql'] },
  'Software Engineer Trainee': { problems: ['two-sum', 'balanced-brackets', 'merge-intervals', 'second-largest'], mix: ['javascript', 'javascript'] },
  'Cloud Support Engineer': { problems: ['balanced-brackets', 'second-largest', 'employee-departments'], mix: ['javascript', 'sql'] },
  'ML Engineer Intern': { problems: ['merge-intervals', 'two-sum', 'high-paying-departments'], mix: ['javascript', 'sql'] },
  'Embedded Systems Engineer': { problems: ['balanced-brackets', 'second-largest'], mix: ['javascript', 'javascript'] },
  'Design Engineer (GET)': { problems: ['second-largest', 'merge-intervals'], mix: ['javascript', 'javascript'] },
  'Junior Site Engineer': { problems: ['second-largest', 'employee-departments'], mix: ['javascript', 'sql'] },
  'Solar Installation Technician': { problems: ['second-largest', 'merge-intervals'], mix: ['javascript', 'javascript'] },
};

// Rahul's preloaded project file for the Live Mutation Probe (labelled preloaded_demo_snapshot).
export const RAHUL_PROBE = {
  repo: 'rahul-deshmukh/campus-canteen-app',
  commitSha: '3f9c2a7d1e8b4c6a9f0e2d1c3b5a7e9f1d2c4b6a',
  filePath: 'src/cart/pricing.js',
  lineStart: 3,
  lineEnd: 13,
  code: `// Computes the amount payable for a cart, in paise: applies a percentage discount, then 5% GST.
// Used by the checkout screen of the canteen app.
function finalAmount(items, discountPercent) {
  let subtotal = 0;
  for (const item of items) {
    subtotal += item.pricePaise * item.qty;
  }
  const discount = Math.round(subtotal * discountPercent / 100);
  const taxable = subtotal - discount;
  const gst = Math.round(taxable * 5 / 100);
  return taxable + gst;
}`,
  predictQuestion: 'Look at finalAmount in your src/cart/pricing.js. What does it return for an empty cart, and what happens if discountPercent is 120? Is that acceptable at checkout?',
  predictKeyPoints: [
    { point: 'An empty cart returns 0', keywords: ['returns 0', 'return 0', 'zero', ' 0 '] },
    { point: 'A 120% discount makes the amount negative', keywords: ['negative', 'less than zero', 'below zero', 'minus'] },
    { point: 'Discount must be validated or limited to 0–100', keywords: ['validate', 'clamp', 'limit', 'between 0 and 100', '0 to 100', 'check', 'throw', 'error'] },
  ],
  mutationTask: 'Change finalAmount so that a discount below 0 or above 100 throws a RangeError, and items with a quantity of 0 or less are ignored. Everything else must behave as before.',
  reference: `function finalAmount(items, discountPercent) {
  if (discountPercent < 0 || discountPercent > 100) throw new RangeError('discount out of range');
  let subtotal = 0;
  for (const item of items) {
    if (item.qty <= 0) continue;
    subtotal += item.pricePaise * item.qty;
  }
  const discount = Math.round(subtotal * discountPercent / 100);
  const taxable = subtotal - discount;
  const gst = Math.round(taxable * 5 / 100);
  return taxable + gst;
}`,
  hiddenTests: [
    { input: [[{ pricePaise: 4000, qty: 2 }, { pricePaise: 2500, qty: 1 }], 10], description: 'normal cart with 10% discount' },
    { input: [[], 0], description: 'empty cart' },
    { input: [[{ pricePaise: 4000, qty: 1 }], 120], expectError: 'RangeError', description: 'discount above 100% is rejected' },
    { input: [[{ pricePaise: 4000, qty: 1 }], -5], expectError: 'RangeError', description: 'negative discount is rejected' },
    { input: [[{ pricePaise: 4000, qty: 0 }, { pricePaise: 1000, qty: -1 }, { pricePaise: 3000, qty: 1 }], 0], description: 'zero and negative quantities ignored' },
    { input: [[{ pricePaise: 999, qty: 3 }], 33], description: 'rounding of discount and GST' },
  ],
};
