 update certificates set status = $2, updated = $3, installed = $4, issued = coalesce($5, issued), expires = coalesce($6, expires) where certificate = $1