document.getElementById('save-profile-btn').addEventListener('click', () => {
    const profileVisibility = document.getElementById('profile-visibility').value;
    const status = document.getElementById('profile-status');

    fetch('/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileVisibility })
    })
        .then(res => {
            if (!res.ok) throw new Error('Unable to save profile settings.');
            return res.json();
        })
        .then(() => {
            status.textContent = `Profile is ${profileVisibility}.`;
        })
        .catch(error => {
            status.textContent = error.message;
        });
});
