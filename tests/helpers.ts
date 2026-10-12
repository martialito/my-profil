import { createDb, type Db } from '../src/database/client.js';
import type { CandidateProfileInput } from '../src/models/profile.js';

export function testDb(): Db {
  return createDb(':memory:');
}

/** Fictional candidate used across tests (not real personal data). */
export function sampleProfile(): CandidateProfileInput {
  return {
    personal: {
      firstName: 'Alex',
      lastName: 'Martin',
      email: 'alex.martin@example.com',
      phone: '+33 6 12 34 56 78',
      currentLocation: 'Paris, France',
      linkedin: 'https://linkedin.com/in/alex-martin-example',
    },
    headline: 'Business school student — marketing & hospitality',
    summary: 'Master student looking for a 6-month internship in New York.',
    workAuthorization: { authorizedToWorkInUS: 'no', requiresSponsorship: 'yes', visaStatus: 'J-1 (to obtain)' },
    education: [
      { school: 'ESSEC Business School', degree: 'Master in Management', field: 'Marketing', startDate: '2024-09', endDate: '2027-12', gpa: '3.6/4' },
    ],
    experiences: [
      {
        company: 'Hotel Lumière',
        title: 'Front Office Intern',
        location: 'Lyon, France',
        startDate: '2025-06',
        endDate: '2025-11',
        description: 'Guest relations in a 120-room hotel.',
        achievements: ['Raised guest satisfaction score by 12%', 'Handled 40 check-ins per day'],
        technologies: ['Opera PMS'],
        skills: ['Customer service'],
      },
      {
        company: 'Brand & Co',
        title: 'Marketing Assistant',
        startDate: '2024-01',
        endDate: '2024-06',
        achievements: ['Managed Instagram account (5k followers)'],
        technologies: ['Canva', 'Meta Business Suite'],
        skills: ['Social media marketing'],
      },
    ],
    skills: [
      { category: 'technical', name: 'Excel' },
      { category: 'technical', name: 'Google Analytics' },
      { category: 'language', name: 'English', level: 'C1' },
      { category: 'language', name: 'French', level: 'Native' },
      { category: 'soft', name: 'Teamwork' },
    ],
    preferences: {
      preferredIndustries: ['Hospitality', 'Marketing'],
      preferredJobTitles: ['Marketing Intern', 'Hospitality Intern'],
      preferredLocations: ['Manhattan', 'Brooklyn'],
      minimumScore: 80,
      minimumDurationMonths: 5,
    },
  };
}
