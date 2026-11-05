-- ==============================================================================
-- PRAMAAN SEED 001: MULTI-TENANT DEMO DATA
-- ==============================================================================

-- 1. Organizations (Two distinct college tenants for isolation testing)
INSERT INTO organizations (id, kind, name, config, rate_limit_config) VALUES
    ('00000000-0000-0000-0000-000000000001', 'college', 'Apex Institute of Technology', '{"tier": 1}'::jsonb, '{"max_requests_per_min": 100}'::jsonb),
    ('00000000-0000-0000-0000-000000000002', 'college', 'Zenith Engineering College', '{"tier": 2}'::jsonb, '{"max_requests_per_min": 60}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- 2. Departments
INSERT INTO departments (id, org_id, name, code) VALUES
    ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Computer Science & Engineering', 'CSE'),
    ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Information Technology', 'IT'),
    ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 'Computer Engineering', 'CE')
ON CONFLICT (id) DO NOTHING;

-- 3. Users
INSERT INTO users (id, auth_subject, email, full_name) VALUES
    ('20000000-0000-0000-0000-000000000001', 'auth0|tpo_priya', 'priya.sharma@apex.edu', 'Priya Sharma (TPO Officer)'),
    ('20000000-0000-0000-0000-000000000002', 'auth0|mentor_rajesh', 'rajesh.rao@apex.edu', 'Dr. Rajesh Rao (Faculty Mentor)'),
    ('20000000-0000-0000-0000-000000000003', 'auth0|student_aarav', 'aarav.patel@apex.edu', 'Aarav Patel (Student)'),
    ('20000000-0000-0000-0000-000000000004', 'auth0|student_diya', 'diya.nair@apex.edu', 'Diya Nair (Student)'),
    ('20000000-0000-0000-0000-000000000005', 'auth0|recruiter_maya', 'maya.sen@techcorp.io', 'Maya Sen (Recruiter)')
ON CONFLICT (id) DO NOTHING;

-- 4. Memberships
INSERT INTO memberships (id, user_id, org_id, department_id, role) VALUES
    ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', NULL, 'officer'),
    ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'mentor'),
    ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'student'),
    ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'student'),
    ('30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', NULL, 'recruiter')
ON CONFLICT (id) DO NOTHING;

-- 5. Students
INSERT INTO students (id, org_id, user_id, department_id, enrollment_no, graduating_year, is_minor) VALUES
    ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'APEX-2023-CS-042', 2027, FALSE),
    ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'APEX-2023-IT-018', 2027, FALSE)
ON CONFLICT (id) DO NOTHING;

-- 6. Academic Records
INSERT INTO academic_records (student_id, cgpa, active_backlogs) VALUES
    ('40000000-0000-0000-0000-000000000001', 8.65, 0),
    ('40000000-0000-0000-0000-000000000002', 7.90, 0);

-- 7. Skills Master Catalog
INSERT INTO skills (id, canonical_name, category, description) VALUES
    ('50000000-0000-0000-0000-000000000001', 'Python', 'Backend & Data', 'Proficiency in Python 3.x, data structures, algorithms, and idiomatic programming.'),
    ('50000000-0000-0000-0000-000000000002', 'SQL', 'Databases', 'Relational database design, querying, joins, aggregations, and query optimization.'),
    ('50000000-0000-0000-0000-000000000003', 'TypeScript', 'Frontend & Fullstack', 'Static typing in JavaScript, modern ES features, React/Node.js application development.'),
    ('50000000-0000-0000-0000-000000000004', 'Docker', 'DevOps & Systems', 'Containerization, Dockerfile authoring, multi-stage builds, and container networking.')
ON CONFLICT (id) DO NOTHING;

