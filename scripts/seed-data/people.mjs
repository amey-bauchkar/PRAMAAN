/**
 * Name pools for the synthetic seed. Names are grouped by region and community so that first names and
 * surnames go together the way they do in real Indian classrooms (a Marathi given name with a Marathi
 * surname, a Muslim given name with a Muslim surname, and so on). Pairs are drawn without repetition.
 * All pairings are generated; none refers to a real person.
 */
export const GROUPS = {
  marathi: {
    f: ['Aditi', 'Ananya', 'Apurva', 'Gauri', 'Isha', 'Janhavi', 'Kalyani', 'Komal', 'Mrunal', 'Neha', 'Pooja', 'Prajakta', 'Rutuja', 'Sakshi', 'Samruddhi', 'Shraddha', 'Shruti', 'Sneha', 'Tanvi', 'Vaishnavi', 'Manasi', 'Pranali', 'Snehal', 'Sayali', 'Revati', 'Ketaki', 'Dipali', 'Aarti', 'Rasika', 'Ashwini'],
    m: ['Aditya', 'Akash', 'Atharva', 'Chinmay', 'Omkar', 'Onkar', 'Pratik', 'Pranav', 'Rohan', 'Saurabh', 'Shubham', 'Siddhesh', 'Swapnil', 'Tejas', 'Vedant', 'Yash', 'Sagar', 'Nilesh', 'Rahul', 'Prasad', 'Mayur', 'Ganesh', 'Sumit', 'Abhishek', 'Kunal', 'Ajinkya', 'Harshad', 'Vaibhav', 'Nitin', 'Amol'],
    s: ['Patil', 'Deshmukh', 'Kulkarni', 'Joshi', 'Shinde', 'Pawar', 'Jadhav', 'More', 'Gaikwad', 'Chavan', 'Bhosale', 'Kamble', 'Naik', 'Wagh', 'Salunkhe', 'Mane', 'Deshpande', 'Gokhale', 'Phadke', 'Sawant', 'Raut', 'Thorat', 'Kale', 'Bhide', 'Dhuri', 'Surve', 'Gawade', 'Tawde', 'Mhatre', 'Kadam', 'Lokhande', 'Sonawane', 'Ghadge', 'Nikam', 'Pansare'],
  },
  hindi: {
    f: ['Anjali', 'Divya', 'Kritika', 'Megha', 'Nikita', 'Priya', 'Riya', 'Shweta', 'Simran', 'Swati', 'Pallavi', 'Ritika', 'Shalini', 'Garima'],
    m: ['Aman', 'Ankit', 'Ashish', 'Deepak', 'Gaurav', 'Manish', 'Mohit', 'Nikhil', 'Piyush', 'Rajat', 'Sachin', 'Vikas', 'Vivek', 'Shivam'],
    s: ['Sharma', 'Verma', 'Gupta', 'Mishra', 'Tiwari', 'Yadav', 'Pandey', 'Dubey', 'Chauhan', 'Srivastava', 'Agarwal', 'Singh', 'Tripathi', 'Saxena'],
  },
  gujarati_marwari: {
    f: ['Hetal', 'Khushi', 'Mansi', 'Nidhi', 'Palak', 'Riddhi', 'Krupa'],
    m: ['Dhruv', 'Harsh', 'Jainam', 'Kunal', 'Meet', 'Parth', 'Smit', 'Yug'],
    s: ['Shah', 'Mehta', 'Patel', 'Jain', 'Doshi', 'Modi', 'Agrawal', 'Bhandari', 'Rathod', 'Desai'],
  },
  south: {
    f: ['Lavanya', 'Nandini', 'Divya', 'Keerthana', 'Harini', 'Swathi', 'Meenakshi', 'Sowmya'],
    m: ['Arvind', 'Karthik', 'Vignesh', 'Srinivas', 'Naveen', 'Ravi', 'Praveen', 'Ganesh'],
    s: ['Iyer', 'Nair', 'Reddy', 'Rao', 'Menon', 'Krishnan', 'Pillai', 'Naidu', 'Subramanian', 'Hegde', 'Shetty', 'Kamath'],
  },
  muslim: {
    f: ['Fatima', 'Sana', 'Ayesha', 'Zoya', 'Rukhsar', 'Nazneen', 'Aliya', 'Mariam', 'Sumaiya', 'Farheen'],
    m: ['Imran', 'Faizan', 'Arbaaz', 'Zeeshan', 'Danish', 'Mohammad', 'Rizwan', 'Aman', 'Zaid', 'Adnan', 'Shoaib', 'Sameer'],
    s: ['Khan', 'Shaikh', 'Sayyed', 'Pathan', 'Ansari', 'Qureshi', 'Mulla', 'Inamdar', 'Momin', 'Attar', 'Tamboli', 'Siddiqui', 'Ali'],
  },
  sikh_punjabi: {
    f: ['Harpreet', 'Simran', 'Gurleen', 'Manpreet', 'Jasleen'],
    m: ['Gurpreet', 'Harjot', 'Jaspreet', 'Manjot', 'Amrit', 'Navdeep'],
    s: ['Singh', 'Kaur', 'Gill', 'Sandhu', 'Bajwa', 'Chadha', 'Arora', 'Bhatia'],
  },
  bengali_odia: {
    f: ['Ritwika', 'Sreya', 'Debjani', 'Sayantani', 'Subhashree'],
    m: ['Arnab', 'Debasish', 'Soumya', 'Subhajit', 'Anirban', 'Biswajit'],
    s: ['Banerjee', 'Chatterjee', 'Mukherjee', 'Das', 'Ghosh', 'Sen', 'Mohanty', 'Panda', 'Sahoo', 'Dutta'],
  },
  goan_christian: {
    f: ['Anita', 'Sheryl', 'Jenifer', 'Priyanka', 'Merlyn', 'Cynthia'],
    m: ['Joel', 'Savio', 'Clinton', 'Rohit', 'Glen', 'Nelson', 'Aaron'],
    s: ['Fernandes', 'DSouza', 'Pereira', 'Rodrigues', 'Gomes', 'Lobo', 'Dias', 'Pinto', 'Menezes', 'Dsilva'],
  },
};

/** Community mix per college, as [group, weight]. Pune-region engineering college vs. Konkan polytechnic. */
export const MIX = {
  collegeA: [['marathi', 0.55], ['hindi', 0.12], ['south', 0.08], ['muslim', 0.08], ['gujarati_marwari', 0.06], ['goan_christian', 0.05], ['bengali_odia', 0.03], ['sikh_punjabi', 0.03]],
  collegeB: [['marathi', 0.8], ['muslim', 0.08], ['goan_christian', 0.07], ['hindi', 0.05]],
};

/** Returns a function that yields unique full names using the supplied uniform random source. */
export function nameMaker(rng) {
  const used = new Set();
  const pickFrom = arr => arr[Math.floor(rng() * arr.length)];
  const pickGroup = mix => {
    let r = rng();
    for (const [g, w] of mix) { if ((r -= w) < 0) return g; }
    return mix[0][0];
  };
  return function make(mix, female) {
    for (let tries = 0; tries < 60; tries++) {
      const g = GROUPS[pickGroup(mix)];
      const first = pickFrom(female ? g.f : g.m);
      const last = pickFrom(g.s);
      // Sikh women are Kaur; a Singh surname is not paired with a female given name there.
      const surname = female && last === 'Singh' && g === GROUPS.sikh_punjabi ? 'Kaur' : last;
      const full = `${first} ${surname}`;
      if (!used.has(full)) { used.add(full); return { first, last: surname }; }
    }
    // Pool exhausted for this mix: allow a repeat rather than looping forever.
    const g = GROUPS.marathi;
    return { first: pickFrom(female ? g.f : g.m), last: pickFrom(g.s) };
  };
}
