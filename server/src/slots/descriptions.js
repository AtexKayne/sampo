export async function listSlotDescriptions(sql) {
  const rows = await sql`
    SELECT description
    FROM slots
    WHERE description IS NOT NULL
    GROUP BY description
    ORDER BY max(created_at) DESC, description
    LIMIT 40
  `;
  return rows.map((row) => row.description);
}
