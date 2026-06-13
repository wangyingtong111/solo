local key = KEYS[1]
local tx_key = KEYS[2]
local tx_id = ARGV[1]

local quantity = redis.call('HGET', tx_key, tx_id)
if not quantity then
    return -1
end

quantity = tonumber(quantity)

redis.call('INCRBY', key, quantity)
redis.call('HDEL', tx_key, tx_id)

return quantity
