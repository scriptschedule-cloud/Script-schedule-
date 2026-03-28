document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('beta-form');
  const successMessage = document.getElementById('success-message');

  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();

      const name = document.getElementById('name').value.trim();
      const email = document.getElementById('email').value.trim();

      if (!name) {
        alert('Please enter your first name.');
        return;
      }

      if (!email || !email.includes('@')) {
        alert('Please enter a valid email address.');
        return;
      }

      successMessage.style.display = 'block';
      form.reset();
    });
  }
});
