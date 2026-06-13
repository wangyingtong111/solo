local tx_key = KEYS[1]
local sold_key = KEYS[2]
local tx_id = ARGV[1]

local detail = redis.call('HGET', tx_key, tx_id)
if not detail then
    return -1
end

local total = 0
for entry in string.gmatch(detail, '([^,]+)') do
    local _, seg_qty = entry:match('(%d+):(%d+)')
    if seg_qty then
        total = total + tonumber(seg_qty)
    end
end

redis.call('HDEL', tx_key, tx_id)
redis.call('INCRBY', sold_key, total)

return total
