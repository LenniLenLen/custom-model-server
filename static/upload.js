const form = document.getElementById('uploadForm');
const list = document.getElementById('modelList');

async function fetchModels() {
  const res = await fetch('/models');
  const models = await res.json();
  list.innerHTML = '';
  models.forEach(m => {
    const li = document.createElement('li');
    li.textContent = m.name;
    if (m.owned) {
      const btn = document.createElement('button');
      btn.textContent = 'Delete';
      btn.onclick = async () => {
        await fetch('/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file: m.name })
        });
        fetchModels();
      };
      li.appendChild(btn);
    }
    list.appendChild(li);
  });
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  const data = new FormData(form);
  const res = await fetch('/upload', { method: 'POST', body: data });
  const result = await res.json();
  alert(result.message);
  form.reset();
  fetchModels();
});

fetchModels();
