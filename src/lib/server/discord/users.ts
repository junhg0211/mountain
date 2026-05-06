const API_BASE_URL = 'https://discord.com/api/v10';

export async function getMe(token: string): Promise<any> {
	if (token === 'undefined' || token === 'null' || !token) {
		console.error('Invalid token provided');
		return null;
	}

	const response = await fetch(`${API_BASE_URL}/users/@me`, {
		headers: {
			Authorization: `Bearer ${token}`
		}
	});

	if (!response.ok) {
		console.error('Error fetching user data:', response.statusText);
		return null;
	}

	return response.json();
}
