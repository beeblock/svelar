#!/bin/bash
# PostgreSQL Backup Script
# Performs full backup with pg_dump and manages retention

# Configuration
DB_NAME="mydb"
DB_USER="postgres"
DB_HOST="localhost"
DB_PORT="5432"

BACKUP_DIR="/backup/postgresql"
RETENTION_DAYS=7

# Create backup directory if not exists
mkdir -p "$BACKUP_DIR"

# Date format for backup file
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${DATE}.dump"
LOG_FILE="$BACKUP_DIR/backup_${DATE}.log"

# Log function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "Starting backup of database: $DB_NAME"

# Perform backup
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -Fc "$DB_NAME" > "$BACKUP_FILE" 2>> "$LOG_FILE"

# Check if backup was successful
if [ $? -eq 0 ]; then
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    log "Backup completed successfully: $BACKUP_FILE ($BACKUP_SIZE)"

    # Compress backup (optional, pg_dump -Fc already compresses)
    # gzip "$BACKUP_FILE"
    # log "Backup compressed: ${BACKUP_FILE}.gz"

    # Verify backup integrity
    pg_restore --list "$BACKUP_FILE" > /dev/null 2>> "$LOG_FILE"
    if [ $? -eq 0 ]; then
        log "Backup verified successfully"
    else
        log "ERROR: Backup verification failed!"
        exit 1
    fi

    # Clean up old backups
    log "Cleaning up backups older than $RETENTION_DAYS days"
    find "$BACKUP_DIR" -name "${DB_NAME}_*.dump" -type f -mtime +$RETENTION_DAYS -delete 2>> "$LOG_FILE"
    find "$BACKUP_DIR" -name "backup_*.log" -type f -mtime +$RETENTION_DAYS -delete 2>> "$LOG_FILE"

    # Upload to S3 (optional)
    # aws s3 cp "$BACKUP_FILE" "s3://my-backups/postgresql/" && log "Backup uploaded to S3"

    log "Backup process completed"
else
    log "ERROR: Backup failed!"
    # Send alert (email, Slack, etc.)
    # echo "Backup failed for $DB_NAME" | mail -s "Backup Failed" admin@example.com
    exit 1
fi

exit 0
