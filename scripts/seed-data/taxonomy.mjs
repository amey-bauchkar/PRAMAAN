// PRAMAAN skill taxonomy v1 (Phase 0). ~150 skills across software, data/AI, core engineering,
// aptitude and professional skills, so non-CS branches (PS: polytechnic, core) are first-class.
//
// Each entry: [slug, canonical name, category, half-life days, aliases[], escoLabel?, onetLabel?]
// escoLabel / onetLabel are PROPOSED search labels for mapping to ESCO and O*NET. They are seeded with
// status 'pending_review' and NULL codes; they must be confirmed against the official ESCO / O*NET
// sources before being displayed as an official alignment (see migration 018).

const Y1 = 365, Y2 = 730;

export const TAXONOMY = [
  // Programming languages
  ['python', 'Python', 'Programming Languages', Y1, ['py', 'python3'], 'Python (computer programming)', 'Python'],
  ['java', 'Java', 'Programming Languages', Y1, ['core java'], 'Java (computer programming)', 'Oracle Java'],
  ['c', 'C', 'Programming Languages', Y2, ['c language', 'ansi c'], 'C (computer programming)', 'C'],
  ['cpp', 'C++', 'Programming Languages', Y2, ['cpp', 'c plus plus'], 'C++', 'C++'],
  ['javascript', 'JavaScript', 'Programming Languages', Y1, ['js', 'ecmascript'], 'JavaScript', 'JavaScript'],
  ['typescript', 'TypeScript', 'Programming Languages', Y1, ['ts'], 'TypeScript', 'TypeScript'],
  ['go', 'Go', 'Programming Languages', Y1, ['golang'], 'Go (computer programming)', 'Go'],
  ['rust', 'Rust', 'Programming Languages', Y1, [], 'Rust', 'Rust'],
  ['kotlin', 'Kotlin', 'Programming Languages', Y1, [], 'Kotlin', 'Kotlin'],
  ['swift', 'Swift', 'Programming Languages', Y1, [], 'Swift (computer programming)', 'Apple Swift'],
  ['csharp', 'C#', 'Programming Languages', Y1, ['c sharp', 'c-sharp'], 'C#', 'C#'],
  ['php', 'PHP', 'Programming Languages', Y1, [], 'PHP', 'PHP'],
  ['r-lang', 'R', 'Programming Languages', Y1, ['r programming'], 'R', 'R'],
  ['matlab', 'MATLAB', 'Programming Languages', Y2, ['simulink'], 'MATLAB', 'MathWorks MATLAB'],
  ['scala', 'Scala', 'Programming Languages', Y1, [], 'Scala', 'Scala'],
  ['dart', 'Dart', 'Programming Languages', Y1, [], null, null],
  ['shell-scripting', 'Shell Scripting', 'Programming Languages', Y2, ['bash', 'shell'], 'shell script', 'Bash'],

  // Web development
  ['html', 'HTML', 'Web Development', Y2, ['html5'], 'HTML', 'Hypertext markup language HTML'],
  ['css', 'CSS', 'Web Development', Y2, ['css3'], 'CSS', 'Cascading style sheets CSS'],
  ['react', 'React', 'Web Development', Y1, ['reactjs', 'react.js'], null, 'React'],
  ['nextjs', 'Next.js', 'Web Development', Y1, ['next'], null, null],
  ['angular', 'Angular', 'Web Development', Y1, ['angularjs'], null, 'AngularJS'],
  ['vue', 'Vue.js', 'Web Development', Y1, ['vue'], null, 'Vue.js'],
  ['nodejs', 'Node.js', 'Web Development', Y1, ['node'], null, 'Node.js'],
  ['express', 'Express.js', 'Web Development', Y1, ['expressjs'], null, null],
  ['django', 'Django', 'Web Development', Y1, [], null, 'Django'],
  ['flask', 'Flask', 'Web Development', Y1, [], null, null],
  ['fastapi', 'FastAPI', 'Web Development', Y1, [], null, null],
  ['spring-boot', 'Spring Boot', 'Web Development', Y1, ['spring'], null, 'Spring Framework'],
  ['dotnet', '.NET', 'Web Development', Y1, ['asp.net', 'dotnet core'], null, 'Microsoft .NET Framework'],
  ['rest-api', 'REST API Design', 'Web Development', Y2, ['rest', 'restful apis'], null, 'Representational state transfer REST'],
  ['graphql', 'GraphQL', 'Web Development', Y1, [], null, 'GraphQL'],
  ['tailwind', 'Tailwind CSS', 'Web Development', Y1, ['tailwindcss'], null, null],

  // Mobile
  ['android', 'Android Development', 'Mobile Development', Y1, ['android studio'], null, 'Google Android'],
  ['flutter', 'Flutter', 'Mobile Development', Y1, [], null, 'Flutter'],
  ['react-native', 'React Native', 'Mobile Development', Y1, [], null, 'React Native'],
  ['ios', 'iOS Development', 'Mobile Development', Y1, [], null, 'Apple iOS'],

  // Databases
  ['sql', 'SQL', 'Databases', Y2, ['structured query language'], 'SQL', 'Structured query language SQL'],
  ['postgresql', 'PostgreSQL', 'Databases', Y1, ['postgres'], 'PostgreSQL', 'PostgreSQL'],
  ['mysql', 'MySQL', 'Databases', Y1, [], 'MySQL', 'MySQL'],
  ['mongodb', 'MongoDB', 'Databases', Y1, ['mongo'], null, 'MongoDB'],
  ['redis', 'Redis', 'Databases', Y1, [], null, 'Redis'],
  ['database-design', 'Database Design', 'Databases', Y2, ['data modelling', 'er modelling'], 'database design', null],
  ['query-optimisation', 'Query Optimisation', 'Databases', Y2, ['query tuning'], null, null],
  ['nosql', 'NoSQL Databases', 'Databases', Y1, [], 'NoSQL', 'NoSQL'],

  // Data & AI
  ['pandas', 'Pandas', 'Data & AI', Y1, [], null, 'pandas'],
  ['numpy', 'NumPy', 'Data & AI', Y1, [], null, 'NumPy'],
  ['data-analysis', 'Data Analysis', 'Data & AI', Y2, ['data analytics'], 'analyse data', null],
  ['data-visualisation', 'Data Visualisation', 'Data & AI', Y2, ['data visualization'], 'data visualisation software', null],
  ['power-bi', 'Power BI', 'Data & AI', Y1, ['powerbi'], null, 'Microsoft Power BI'],
  ['tableau', 'Tableau', 'Data & AI', Y1, [], null, 'Tableau'],
  ['excel', 'Microsoft Excel', 'Data & AI', Y2, ['excel', 'spreadsheets'], 'use spreadsheets software', 'Microsoft Excel'],
  ['statistics', 'Statistics', 'Data & AI', Y2, ['probability and statistics'], 'statistics', null],
  ['machine-learning', 'Machine Learning', 'Data & AI', Y1, ['ml'], 'machine learning', null],
  ['deep-learning', 'Deep Learning', 'Data & AI', Y1, ['dl', 'neural networks'], null, null],
  ['tensorflow', 'TensorFlow', 'Data & AI', Y1, [], null, 'TensorFlow'],
  ['pytorch', 'PyTorch', 'Data & AI', Y1, [], null, 'PyTorch'],
  ['scikit-learn', 'scikit-learn', 'Data & AI', Y1, ['sklearn'], null, 'scikit-learn'],
  ['nlp', 'Natural Language Processing', 'Data & AI', Y1, ['nlp'], null, null],
  ['computer-vision', 'Computer Vision', 'Data & AI', Y1, ['cv', 'opencv'], null, null],
  ['genai-apps', 'Generative AI Applications', 'Data & AI', Y1, ['llm apps', 'genai', 'rag'], null, null],
  ['prompt-engineering', 'Prompt Engineering', 'Data & AI', Y1, [], null, null],
  ['mlops', 'MLOps', 'Data & AI', Y1, [], null, null],
  ['spark', 'Apache Spark', 'Data & AI', Y1, ['spark', 'pyspark'], null, 'Apache Spark'],
  ['hadoop', 'Hadoop', 'Data & AI', Y1, [], 'Hadoop', 'Apache Hadoop'],
  ['etl', 'ETL Pipelines', 'Data & AI', Y1, ['data pipelines'], null, null],
  ['airflow', 'Apache Airflow', 'Data & AI', Y1, ['airflow'], null, 'Apache Airflow'],

  // Cloud & DevOps
  ['docker', 'Docker', 'Cloud & DevOps', Y1, ['containers'], null, 'Docker'],
  ['kubernetes', 'Kubernetes', 'Cloud & DevOps', Y1, ['k8s'], null, 'Kubernetes'],
  ['aws', 'Amazon Web Services', 'Cloud & DevOps', Y1, ['aws'], null, 'Amazon Web Services AWS software'],
  ['azure', 'Microsoft Azure', 'Cloud & DevOps', Y1, ['azure'], null, 'Microsoft Azure software'],
  ['gcp', 'Google Cloud Platform', 'Cloud & DevOps', Y1, ['gcp'], null, 'Google Cloud software'],
  ['linux', 'Linux', 'Cloud & DevOps', Y2, ['unix'], 'Linux', 'Linux'],
  ['git', 'Git', 'Cloud & DevOps', Y2, ['github', 'version control'], 'tools for software configuration management', 'Git'],
  ['github-actions', 'GitHub Actions', 'Cloud & DevOps', Y1, [], null, null],
  ['ci-cd', 'CI/CD', 'Cloud & DevOps', Y1, ['continuous integration'], null, null],
  ['terraform', 'Terraform', 'Cloud & DevOps', Y1, [], null, 'Terraform'],
  ['nginx', 'Nginx', 'Cloud & DevOps', Y1, [], null, 'NGINX'],
  ['monitoring', 'Monitoring & Observability', 'Cloud & DevOps', Y1, ['prometheus', 'grafana'], null, null],

  // CS fundamentals
  ['data-structures', 'Data Structures', 'CS Fundamentals', Y2, ['ds', 'dsa'], null, null],
  ['algorithms', 'Algorithms', 'CS Fundamentals', Y2, ['algo'], 'algorithms', null],
  ['oop', 'Object-Oriented Programming', 'CS Fundamentals', Y2, ['oops'], 'object-oriented programming', null],
  ['operating-systems', 'Operating Systems', 'CS Fundamentals', Y2, ['os'], null, null],
  ['computer-networks', 'Computer Networks', 'CS Fundamentals', Y2, ['networking', 'cn'], null, null],
  ['dbms', 'DBMS Concepts', 'CS Fundamentals', Y2, ['dbms'], null, null],
  ['system-design', 'System Design', 'CS Fundamentals', Y1, ['hld', 'lld'], null, null],
  ['design-patterns', 'Design Patterns', 'CS Fundamentals', Y2, [], null, null],
  ['software-testing', 'Software Testing', 'CS Fundamentals', Y2, ['qa', 'testing'], 'software testing', null],
  ['unit-testing', 'Unit Testing', 'CS Fundamentals', Y2, ['junit', 'pytest', 'jest'], null, null],
  ['selenium', 'Selenium', 'CS Fundamentals', Y1, [], null, 'Selenium'],
  ['agile', 'Agile & Scrum', 'CS Fundamentals', Y2, ['scrum'], 'Agile project management', null],
  ['software-engineering', 'Software Engineering', 'CS Fundamentals', Y2, ['sdlc'], null, null],
  ['discrete-math', 'Discrete Mathematics', 'CS Fundamentals', Y2, [], null, null],

  // Security
  ['cybersecurity', 'Cybersecurity Fundamentals', 'Security', Y1, ['cyber security'], null, null],
  ['network-security', 'Network Security', 'Security', Y1, [], null, null],
  ['web-security', 'Web Application Security', 'Security', Y1, ['owasp'], null, null],
  ['cryptography', 'Cryptography Basics', 'Security', Y2, [], null, null],
  ['ethical-hacking', 'Ethical Hacking', 'Security', Y1, ['penetration testing'], null, null],

  // Electronics & Telecommunication
  ['embedded-c', 'Embedded C', 'Electronics', Y2, [], null, null],
  ['arduino', 'Arduino', 'Electronics', Y1, [], null, null],
  ['raspberry-pi', 'Raspberry Pi', 'Electronics', Y1, [], null, null],
  ['microcontrollers', 'Microcontrollers', 'Electronics', Y2, ['8051', 'arm cortex', 'stm32'], null, null],
  ['pcb-design', 'PCB Design', 'Electronics', Y2, ['kicad', 'eagle'], null, null],
  ['vlsi', 'VLSI Design', 'Electronics', Y2, [], null, null],
  ['verilog', 'Verilog', 'Electronics', Y2, [], null, null],
  ['vhdl', 'VHDL', 'Electronics', Y2, [], null, null],
  ['digital-electronics', 'Digital Electronics', 'Electronics', Y2, [], null, null],
  ['analog-electronics', 'Analog Electronics', 'Electronics', Y2, [], null, null],
  ['signal-processing', 'Signal Processing', 'Electronics', Y2, ['dsp'], null, null],
  ['iot', 'Internet of Things', 'Electronics', Y1, ['iot'], null, null],
  ['communication-systems', 'Communication Systems', 'Electronics', Y2, [], null, null],
  ['plc', 'PLC Programming', 'Electronics', Y2, ['ladder logic'], null, null],
  ['scada', 'SCADA', 'Electronics', Y2, [], null, null],

  // Mechanical
  ['autocad', 'AutoCAD', 'Mechanical & Civil', Y2, [], null, 'Autodesk AutoCAD'],
  ['solidworks', 'SolidWorks', 'Mechanical & Civil', Y2, [], null, 'Dassault Systemes SolidWorks'],
  ['catia', 'CATIA', 'Mechanical & Civil', Y2, [], null, 'Dassault Systemes CATIA'],
  ['ansys', 'ANSYS', 'Mechanical & Civil', Y2, ['fea'], null, 'ANSYS'],
  ['cnc-programming', 'CNC Programming', 'Mechanical & Civil', Y2, ['g-code'], null, null],
  ['gdt', 'GD&T', 'Mechanical & Civil', Y2, ['geometric dimensioning'], null, null],
  ['manufacturing-processes', 'Manufacturing Processes', 'Mechanical & Civil', Y2, [], null, null],
  ['thermodynamics', 'Thermodynamics', 'Mechanical & Civil', Y2, [], null, null],
  ['hvac', 'HVAC Design', 'Mechanical & Civil', Y2, [], null, null],

  // Civil
  ['staad-pro', 'STAAD.Pro', 'Mechanical & Civil', Y2, ['staad'], null, null],
  ['revit', 'Revit', 'Mechanical & Civil', Y2, ['bim'], null, 'Autodesk Revit'],
  ['surveying', 'Surveying', 'Mechanical & Civil', Y2, [], null, null],
  ['estimation-costing', 'Estimation & Costing', 'Mechanical & Civil', Y2, ['quantity surveying'], null, null],

  // Electrical
  ['power-systems', 'Power Systems', 'Electrical', Y2, [], null, null],
  ['electrical-machines', 'Electrical Machines', 'Electrical', Y2, [], null, null],
  ['electrical-design', 'Electrical Design', 'Electrical', Y2, [], null, null],
  ['control-systems', 'Control Systems', 'Electrical', Y2, [], null, null],
  ['solar-pv', 'Solar PV Design', 'Electrical', Y2, [], null, null],
  ['etap', 'ETAP', 'Electrical', Y2, [], null, null],

  // Design & product
  ['ui-ux', 'UI/UX Design', 'Design & Product', Y1, ['ux', 'ui design'], null, null],
  ['figma', 'Figma', 'Design & Product', Y1, [], null, 'Figma'],
  ['product-management', 'Product Management Basics', 'Design & Product', Y2, [], null, null],
  ['business-analysis', 'Business Analysis', 'Design & Product', Y2, [], null, null],
  ['digital-marketing', 'Digital Marketing', 'Design & Product', Y1, ['seo'], null, null],

  // Aptitude (assessed by mock drive round 1)
  ['quant-aptitude', 'Quantitative Aptitude', 'Aptitude', Y2, ['quant'], null, null],
  ['logical-reasoning', 'Logical Reasoning', 'Aptitude', Y2, ['reasoning'], null, null],
  ['verbal-ability', 'Verbal Ability', 'Aptitude', Y2, ['english'], null, null],
  ['problem-solving', 'Problem Solving', 'Aptitude', Y2, ['competitive programming'], 'solve problems', null],

  // Professional skills
  ['communication', 'Communication', 'Professional Skills', Y2, [], 'communication', null],
  ['technical-writing', 'Technical Writing', 'Professional Skills', Y2, ['documentation'], null, null],
  ['teamwork', 'Teamwork', 'Professional Skills', Y2, ['collaboration'], 'work in teams', null],
  ['presentation', 'Presentation Skills', 'Professional Skills', Y2, [], null, null],
];
