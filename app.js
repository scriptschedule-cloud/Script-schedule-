let data = JSON.parse(localStorage.getItem('scriptSchedule') || '[]');

function save(){
  localStorage.setItem('scriptSchedule', JSON.stringify(data));
  render();
}

function addMember(){
  const name = document.getElementById('name').value;
  if(!name) return;

  data.push({ name, meds: [] });
  document.getElementById('name').value = '';
  save();
}

function addMed(i){
  const med = prompt("Medication name?");
  if(!med) return;

  data[i].meds.push({
    name: med,
    taken: false
  });

  save();
}

function toggle(i,j){
  data[i].meds[j].taken = !data[i].meds[j].taken;
  save();
}

function render(){
  const container = document.getElementById('members');
  container.innerHTML = '';

  data.forEach((person, i) => {
    const div = document.createElement('div');
    div.className = 'card';

    div.innerHTML = `
      <h3>${person.name}</h3>
      <button onclick="addMed(${i})">Add Medication</button>
    `;

    person.meds.forEach((med, j) => {
      const medDiv = document.createElement('div');

      medDiv.innerHTML = `
        <p>${med.name} — ${med.taken ? "✅ Taken" : "❌ Not taken"}</p>
        <button onclick="toggle(${i},${j})">Mark</button>
      `;

      div.appendChild(medDiv);
    });

    container.appendChild(div);
  });
}

render();
