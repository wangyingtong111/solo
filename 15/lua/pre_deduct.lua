local key = KEYS[1]
local tx_key = KEYS[2]
local quantity = tonumber(ARGV[1])
local tx_id = ARGV[2]
local expire_ms = tonumber(ARGV[3])

if redis.call('HEXISTS', tx_key, tx_id) == 1 then
    return -2
end

local current = tonumber(redis.call('GET', key) or '0')
if current < quantity then
    return -1
end

redis.call('DECRBY', key, quantity)
redis.call('HSET', tx_key, tx_id, quantity)
redis.call('PEXPIRE', tx_key, expire_ms)

return current - quantity
